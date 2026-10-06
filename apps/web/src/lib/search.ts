import { and, eq, inArray, sql } from 'drizzle-orm';
import { chunks, documents, subjects } from '@studyhub/db';
import { truncate } from '@studyhub/ai';
import type { SearchResultDto } from '@studyhub/contracts';
import { SubjectNotFoundError } from './errors';

/**
 * `@studyhub/ai/embeddings` pulls in `@xenova/transformers` -> `onnxruntime-node`,
 * a native binary Next's webpack can't parse into the route bundle
 * ("Module parse failed: Unexpected character") even with `serverExternalPackages`
 * set (verified: it still walks into it via this barrel). `webpackIgnore` makes
 * this a literal runtime `import()` Node resolves itself, never bundled.
 */
async function embedQuery(text: string): Promise<number[] | null> {
  try {
    const { embedText } = await import(/* webpackIgnore: true */ '@studyhub/ai/embeddings');
    return await embedText(text);
  } catch {
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

const RRF_K = 60; // standard RRF constant — see e.g. Cormack et al. 2009
const CANDIDATE_LIMIT = 40;
const RESULT_LIMIT = 20;
const EXCERPT_LENGTH = 240;

interface Candidate {
  chunkId: string;
  documentId: string;
  documentName: string;
  pageFrom: number;
  pageTo: number;
  text: string;
}

/** Letters/digits words of 4+ chars, deduplicated: safe to join into a `to_tsquery` (no operators survive). */
function significantTerms(text: string): string[] {
  const words =
    text
      .normalize('NFC')
      .toLowerCase()
      .match(/[\p{L}\p{N}]{4,}/gu) ?? [];
  return [...new Set(words)];
}

interface RankedChunk {
  candidate: Candidate;
  score: number;
}

/**
 * Hybrid FTS + vector search, fused by Reciprocal Rank Fusion (docs/fasi/F1-ingest.md
 * acceptance: "Cerco 'entropia' e trovo il chunk con pagina esatta"). Falls back to
 * FTS-only when the embedding model can't run (e.g. offline on first use, before the
 * model has been downloaded) rather than failing the whole search.
 *
 * `documentIds` restricts the search to those documents (the study-session chat must never see
 * a chunk of a document outside the session — docs/08-sessione-di-studio.md §5.3); `undefined`
 * means the whole subject, an empty list means nothing.
 */
async function rankChunks(
  db: AnyDb,
  subjectId: string,
  trimmed: string,
  limit: number,
  documentIds?: string[],
  matchAny = false,
): Promise<RankedChunk[]> {
  if (documentIds && documentIds.length === 0) return [];
  // A typed search ANDs its words (websearch semantics). A natural-language question ("perché vale
  // Fubini?") would then match nothing, so the chat ORs its significant words instead.
  const anyTerms = matchAny ? significantTerms(trimmed) : [];
  const tsQuery = matchAny
    ? sql`to_tsquery('italian', ${anyTerms.join(' | ')})`
    : sql`websearch_to_tsquery('italian', ${trimmed})`;
  const scope = and(
    eq(documents.subjectId, subjectId),
    documentIds ? inArray(chunks.documentId, documentIds) : undefined,
  );

  const selectCandidate = {
    chunkId: chunks.id,
    documentId: chunks.documentId,
    documentName: documents.originalName,
    pageFrom: chunks.pageFrom,
    pageTo: chunks.pageTo,
    text: chunks.text,
  };

  const ftsRows: Candidate[] =
    matchAny && anyTerms.length === 0
      ? []
      : await db
          .select(selectCandidate)
          .from(chunks)
          .innerJoin(documents, eq(documents.id, chunks.documentId))
          .where(and(scope, sql`to_tsvector('italian', ${chunks.text}) @@ ${tsQuery}`))
          .orderBy(sql`ts_rank_cd(to_tsvector('italian', ${chunks.text}), ${tsQuery}) DESC`)
          .limit(CANDIDATE_LIMIT);

  let vectorRows: Candidate[] = [];
  const embedding = await embedQuery(trimmed);
  if (embedding) {
    const vectorLiteral = `[${embedding.join(',')}]`;
    vectorRows = await db
      .select(selectCandidate)
      .from(chunks)
      .innerJoin(documents, eq(documents.id, chunks.documentId))
      .where(and(scope, sql`${chunks.embedding} IS NOT NULL`))
      .orderBy(sql`${chunks.embedding} <=> ${vectorLiteral}::vector`)
      .limit(CANDIDATE_LIMIT);
  }

  const fused = new Map<string, RankedChunk>();
  const addRanked = (rows: Candidate[]) => {
    rows.forEach((candidate, i) => {
      const entry = fused.get(candidate.chunkId) ?? { candidate, score: 0 };
      entry.score += 1 / (RRF_K + i + 1);
      fused.set(candidate.chunkId, entry);
    });
  };
  addRanked(ftsRows);
  addRanked(vectorRows);

  return [...fused.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

async function requireSubjectId(db: AnyDb, subjectSlug: string): Promise<string> {
  const [subject] = await db.select().from(subjects).where(eq(subjects.slug, subjectSlug));
  if (!subject) throw new SubjectNotFoundError(subjectSlug);
  return subject.id as string;
}

export async function searchSubject(
  db: AnyDb,
  subjectSlug: string,
  query: string,
): Promise<SearchResultDto[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const subjectId = await requireSubjectId(db, subjectSlug);

  return (await rankChunks(db, subjectId, trimmed, RESULT_LIMIT)).map(({ candidate, score }) => ({
    chunkId: candidate.chunkId,
    documentId: candidate.documentId,
    documentName: candidate.documentName,
    pageFrom: candidate.pageFrom,
    pageTo: candidate.pageTo,
    excerpt: truncate(candidate.text, EXCERPT_LENGTH),
    score,
  }));
}

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  documentName: string;
  pageFrom: number;
  pageTo: number;
  /** The whole chunk, not an excerpt: this is what the chat model reads. */
  text: string;
}

/** Same ranking as `searchSubject`, but returns whole chunks and can be limited to a set of documents. */
export async function retrieveChunks(
  db: AnyDb,
  subjectId: string,
  query: string,
  options: { documentIds: string[]; limit: number },
): Promise<RetrievedChunk[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  return (await rankChunks(db, subjectId, trimmed, options.limit, options.documentIds, true)).map(
    ({ candidate }) => candidate,
  );
}

/** The chunks of one document that cover `page` — context for a passage the student selected. */
export async function chunksAtPage(
  db: AnyDb,
  documentId: string,
  page: number,
  limit = 2,
): Promise<RetrievedChunk[]> {
  const rows: RetrievedChunk[] = await db
    .select({
      chunkId: chunks.id,
      documentId: chunks.documentId,
      documentName: documents.originalName,
      pageFrom: chunks.pageFrom,
      pageTo: chunks.pageTo,
      text: chunks.text,
    })
    .from(chunks)
    .innerJoin(documents, eq(documents.id, chunks.documentId))
    .where(
      and(
        eq(chunks.documentId, documentId),
        sql`${chunks.pageFrom} <= ${page}`,
        sql`${chunks.pageTo} >= ${page}`,
      ),
    )
    .orderBy(chunks.ord)
    .limit(limit);
  return rows;
}
