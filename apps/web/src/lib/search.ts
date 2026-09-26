import { and, eq, sql } from 'drizzle-orm';
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

/**
 * Hybrid FTS + vector search, fused by Reciprocal Rank Fusion (docs/fasi/F1-ingest.md
 * acceptance: "Cerco 'entropia' e trovo il chunk con pagina esatta"). Falls back to
 * FTS-only when the embedding model can't run (e.g. offline on first use, before the
 * model has been downloaded) rather than failing the whole search.
 */
export async function searchSubject(
  db: AnyDb,
  subjectSlug: string,
  query: string,
): Promise<SearchResultDto[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const [subject] = await db.select().from(subjects).where(eq(subjects.slug, subjectSlug));
  if (!subject) throw new SubjectNotFoundError(subjectSlug);

  const selectCandidate = {
    chunkId: chunks.id,
    documentId: chunks.documentId,
    documentName: documents.originalName,
    pageFrom: chunks.pageFrom,
    pageTo: chunks.pageTo,
    text: chunks.text,
  };

  const ftsRows: Candidate[] = await db
    .select(selectCandidate)
    .from(chunks)
    .innerJoin(documents, eq(documents.id, chunks.documentId))
    .where(
      and(
        eq(documents.subjectId, subject.id),
        sql`to_tsvector('italian', ${chunks.text}) @@ websearch_to_tsquery('italian', ${trimmed})`,
      ),
    )
    .orderBy(
      sql`ts_rank_cd(to_tsvector('italian', ${chunks.text}), websearch_to_tsquery('italian', ${trimmed})) DESC`,
    )
    .limit(CANDIDATE_LIMIT);

  let vectorRows: Candidate[] = [];
  const embedding = await embedQuery(trimmed);
  if (embedding) {
    const vectorLiteral = `[${embedding.join(',')}]`;
    vectorRows = await db
      .select(selectCandidate)
      .from(chunks)
      .innerJoin(documents, eq(documents.id, chunks.documentId))
      .where(and(eq(documents.subjectId, subject.id), sql`${chunks.embedding} IS NOT NULL`))
      .orderBy(sql`${chunks.embedding} <=> ${vectorLiteral}::vector`)
      .limit(CANDIDATE_LIMIT);
  }

  const fused = new Map<string, { candidate: Candidate; score: number }>();
  const addRanked = (rows: Candidate[]) => {
    rows.forEach((candidate, i) => {
      const entry = fused.get(candidate.chunkId) ?? { candidate, score: 0 };
      entry.score += 1 / (RRF_K + i + 1);
      fused.set(candidate.chunkId, entry);
    });
  };
  addRanked(ftsRows);
  addRanked(vectorRows);

  return [...fused.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, RESULT_LIMIT)
    .map(({ candidate, score }) => ({
      chunkId: candidate.chunkId,
      documentId: candidate.documentId,
      documentName: candidate.documentName,
      pageFrom: candidate.pageFrom,
      pageTo: candidate.pageTo,
      excerpt: truncate(candidate.text, EXCERPT_LENGTH),
      score,
    }));
}
