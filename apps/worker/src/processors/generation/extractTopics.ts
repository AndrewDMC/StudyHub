import { randomUUID } from 'node:crypto';
import { and, eq, inArray, lt } from 'drizzle-orm';
import { chunks, documentTopics, documents, jobs, subjects, topics } from '@studyhub/db';
import { disambiguateSlug, slugify } from '@studyhub/core';
import {
  estimateCostEur,
  resolveProvider,
  truncate,
  EXTRACT_TOPICS_PROMPT_VERSION,
  type AiProvider,
  resolveModel,
} from '@studyhub/ai';
import type { ExtractTopicsJobInput } from '@studyhub/contracts';
import { checkBudget, computeJobKey } from './shared.js';

const MODEL_ROUTING_TOPIC_EXTRACTION = 'claude-haiku-4-5-20251001'; // docs/03-ai-e-worker.md §4: "haiku per estrarre"
const EXCERPT_CHUNK_SAMPLE = 3; // first N chunks per document, not the whole text — keeps the call cheap
const EXCERPT_MAX_CHARS = 2000;

export interface ExtractTopicsResult {
  idempotent: boolean;
  jobKey: string;
  topicsCreated: number;
  linksCreated: number;
  discardedCount: number;
  costEur: number;
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * `extract_topics` (docs/03-ai-e-worker.md §1, docs/fasi/F3-ai-core.md). Unlike
 * `generate_flashcards`/`generate_summary`/`generate_schema` this doesn't produce a draft
 * artifact to review — it proposes a taxonomy and applies it directly as `topics`/
 * `document_topics` rows with `source: 'ai'`, exactly the columns `packages/db/src/schema.ts`
 * already carries for this (`confidence`, `source`). Safe to apply eagerly because it's
 * additive and idempotent: a proposed name that already exists in the subject is reused, never
 * duplicated, and `mergeTopics` (docs/fasi/F2-materie.md) is the tool for cleaning up a bad
 * proposal after the fact.
 */
export async function processExtractTopics(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  _dataRoot: string,
  input: ExtractTopicsJobInput,
  provider: AiProvider = resolveProvider(),
): Promise<ExtractTopicsResult> {
  const [subject] = await db.select().from(subjects).where(eq(subjects.id, input.subjectId));
  if (!subject) throw new Error(`subject not found: ${input.subjectId}`);

  const requestedDocIds = [...new Set(input.docIds)];
  const docRows: { id: string; subjectId: string }[] = await db
    .select({ id: documents.id, subjectId: documents.subjectId })
    .from(documents)
    .where(inArray(documents.id, requestedDocIds));
  const foundIds = new Set(docRows.map((d) => d.id));
  const missing = requestedDocIds.filter((id) => !foundIds.has(id));
  if (missing.length > 0) throw new Error(`Documenti non trovati: ${missing.join(', ')}`);
  const foreign = docRows.filter((d) => d.subjectId !== input.subjectId);
  if (foreign.length > 0) {
    throw new Error(
      `Documenti non appartenenti alla materia richiesta: ${foreign.map((d) => d.id).join(', ')}`,
    );
  }

  const model = input.model ?? resolveModel(MODEL_ROUTING_TOPIC_EXTRACTION);
  const jobKey = computeJobKey({
    type: 'extract_topics',
    subjectId: input.subjectId,
    docIds: [...requestedDocIds].sort(),
    promptVersion: EXTRACT_TOPICS_PROMPT_VERSION,
    model,
  });

  const [priorJob] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.jobKey, jobKey), eq(jobs.status, 'succeeded')))
    .limit(1);
  if (priorJob) {
    return {
      idempotent: true,
      jobKey,
      topicsCreated: 0,
      linksCreated: 0,
      discardedCount: 0,
      costEur: 0,
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  const chunkRows: { documentId: string; ord: number; text: string }[] = await db
    .select({ documentId: chunks.documentId, ord: chunks.ord, text: chunks.text })
    .from(chunks)
    .where(and(inArray(chunks.documentId, requestedDocIds), lt(chunks.ord, EXCERPT_CHUNK_SAMPLE)));
  if (chunkRows.length === 0) {
    throw new Error(
      'Nessun chunk trovato per i documenti indicati: sono stati estratti? (job extract_text)',
    );
  }
  const excerptByDoc = new Map<string, string>();
  for (const docId of requestedDocIds) {
    const parts = chunkRows
      .filter((c) => c.documentId === docId)
      .sort((a, b) => a.ord - b.ord)
      .map((c) => c.text);
    excerptByDoc.set(docId, truncate(parts.join(' '), EXCERPT_MAX_CHARS));
  }

  const existingTopics: { id: string; name: string; slug: string }[] = await db
    .select({ id: topics.id, name: topics.name, slug: topics.slug })
    .from(topics)
    .where(eq(topics.subjectId, input.subjectId));

  const result = await provider.extractTopics(
    {
      subjectName: subject.name,
      documents: requestedDocIds.map((docId) => ({
        docId,
        excerpt: excerptByDoc.get(docId) ?? '',
      })),
      existingTopics: existingTopics.map((t) => ({ name: t.name })),
    },
    model,
  );

  // Anti-hallucination gate, same spirit as a flashcard's citation: a proposed docId the caller
  // never sent is dropped rather than trusted, and a topic left with none is dropped entirely.
  const requestedSet = new Set(requestedDocIds);
  const proposalsWithDocs = result.data.topics
    .map((t) => ({ ...t, docIds: t.docIds.filter((id) => requestedSet.has(id)) }))
    .filter((t) => t.docIds.length > 0);
  const discardedCount = result.data.topics.length - proposalsWithDocs.length;

  // Same gate for `parentName`: valid only if it names an existing topic in the subject, or
  // another proposal in this batch that is itself top-level (no `parentName`) — a hallucinated
  // name, a self-reference, or a chain more than one level deep collapses to top-level (`null`)
  // rather than being trusted or rejecting the whole topic. Root proposals are processed before
  // their children below so a sibling parent's id already exists in `byLowerName` by then.
  const rootProposalNames = new Set(
    proposalsWithDocs.filter((p) => !p.parentName).map((p) => p.name.toLowerCase()),
  );
  const existingNamesLower = new Set(existingTopics.map((t) => t.name.toLowerCase()));
  const proposals = proposalsWithDocs
    .map((p) => {
      const parentLower = p.parentName?.toLowerCase();
      const validParent =
        parentLower &&
        parentLower !== p.name.toLowerCase() &&
        (existingNamesLower.has(parentLower) || rootProposalNames.has(parentLower));
      return { ...p, parentName: validParent ? p.parentName! : null };
    })
    .sort((a, b) => (a.parentName ? 1 : 0) - (b.parentName ? 1 : 0));

  const costEur = estimateCostEur(
    result.model,
    result.usage.inputTokens,
    result.usage.outputTokens,
  );
  await checkBudget(db, costEur, input.force);

  const byLowerName = new Map(existingTopics.map((t) => [t.name.toLowerCase(), t.id]));
  const takenSlugs = new Set(existingTopics.map((t) => t.slug));

  const existingLinks: { documentId: string; topicId: string }[] = await db
    .select({ documentId: documentTopics.documentId, topicId: documentTopics.topicId })
    .from(documentTopics)
    .where(inArray(documentTopics.documentId, requestedDocIds));
  const linkedPairs = new Set(existingLinks.map((l) => `${l.documentId}:${l.topicId}`));

  let topicsCreated = 0;
  let linksCreated = 0;
  for (const proposal of proposals) {
    let topicId = byLowerName.get(proposal.name.toLowerCase());
    if (!topicId) {
      topicId = randomUUID();
      const slug = disambiguateSlug(slugify(proposal.name), takenSlugs);
      takenSlugs.add(slug);
      byLowerName.set(proposal.name.toLowerCase(), topicId);
      const parentId = proposal.parentName
        ? (byLowerName.get(proposal.parentName.toLowerCase()) ?? null)
        : null;
      await db.insert(topics).values({
        id: topicId,
        subjectId: input.subjectId,
        parentId,
        name: proposal.name,
        slug,
        source: 'ai',
        confidence: proposal.confidence,
      });
      topicsCreated += 1;
    }

    const newLinks = proposal.docIds.filter((docId) => !linkedPairs.has(`${docId}:${topicId}`));
    for (const docId of newLinks) linkedPairs.add(`${docId}:${topicId}`);
    if (newLinks.length > 0) {
      await db.insert(documentTopics).values(
        newLinks.map((documentId) => ({
          documentId,
          topicId: topicId!,
          source: 'ai' as const,
          confidence: proposal.confidence,
        })),
      );
      linksCreated += newLinks.length;
    }
  }

  return {
    idempotent: false,
    jobKey,
    topicsCreated,
    linksCreated,
    discardedCount,
    costEur,
    usage: result.usage,
  };
}
