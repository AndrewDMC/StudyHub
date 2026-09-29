import { createHash } from 'node:crypto';
import { and, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import {
  artifacts,
  chunks,
  documentTopics,
  documents,
  flashcards,
  jobs,
  settings,
  topics,
  type JobCost,
} from '@studyhub/db';
import type { GenerationScope } from '@studyhub/contracts';
import type { ChunkRef } from '@studyhub/ai';

export class BudgetExceededError extends Error {
  constructor(
    readonly capEur: number,
    readonly spentEur: number,
    readonly wouldAddEur: number,
  ) {
    super(
      `Budget giornaliero superato: già spesi €${spentEur.toFixed(4)} su €${capEur.toFixed(2)}, ` +
        `questo job aggiungerebbe ~€${wouldAddEur.toFixed(4)}. Rilancia con force:true per procedere comunque.`,
    );
    this.name = 'BudgetExceededError';
  }
}

/**
 * Resolves `scope.topicIds` to the document ids tagged with any of them
 * (docs/fasi/F2-materie.md "Stato": `document_topics`, unblocked here).
 * Validates the topics themselves belong to the subject first, so a foreign
 * or unknown topic id fails with a clear message instead of silently
 * resolving to zero documents.
 */
async function resolveTopicScopeDocIds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  subjectId: string,
  topicIds: string[],
): Promise<string[]> {
  const topicRows: { id: string; subjectId: string }[] = await db
    .select({ id: topics.id, subjectId: topics.subjectId })
    .from(topics)
    .where(inArray(topics.id, topicIds));

  const foundTopicIds = new Set(topicRows.map((t) => t.id));
  const missingTopics = topicIds.filter((id) => !foundTopicIds.has(id));
  if (missingTopics.length > 0) {
    throw new Error(`Argomenti non trovati: ${missingTopics.join(', ')}`);
  }
  const foreignTopics = topicRows.filter((t) => t.subjectId !== subjectId);
  if (foreignTopics.length > 0) {
    throw new Error(
      `Argomenti non appartenenti alla materia richiesta: ${foreignTopics.map((t) => t.id).join(', ')}`,
    );
  }

  const linkRows: { documentId: string }[] = await db
    .select({ documentId: documentTopics.documentId })
    .from(documentTopics)
    .where(inArray(documentTopics.topicId, topicIds));
  const docIds = [...new Set(linkRows.map((r) => r.documentId))];
  if (docIds.length === 0) {
    throw new Error(
      'Nessun documento collegato agli argomenti indicati: taggali prima dalla pagina materia.',
    );
  }
  return docIds;
}

/** Resolves a generation scope (`docIds` and/or `topicIds`) to the chunks it covers. */
export async function resolveScopeChunks(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  subjectId: string,
  scope: GenerationScope,
): Promise<ChunkRef[]> {
  const docIds =
    scope.docIds && scope.docIds.length > 0
      ? scope.docIds
      : await resolveTopicScopeDocIds(db, subjectId, scope.topicIds ?? []);

  const docRows: { id: string; subjectId: string }[] = await db
    .select({ id: documents.id, subjectId: documents.subjectId })
    .from(documents)
    .where(inArray(documents.id, docIds));

  const foundIds = new Set(docRows.map((d) => d.id));
  const missing = docIds.filter((id) => !foundIds.has(id));
  if (missing.length > 0) {
    throw new Error(`Documenti non trovati: ${missing.join(', ')}`);
  }
  const foreign = docRows.filter((d) => d.subjectId !== subjectId);
  if (foreign.length > 0) {
    throw new Error(
      `Documenti non appartenenti alla materia richiesta: ${foreign.map((d) => d.id).join(', ')}`,
    );
  }

  const rows: { documentId: string; pageFrom: number; text: string }[] = await db
    .select({ documentId: chunks.documentId, pageFrom: chunks.pageFrom, text: chunks.text })
    .from(chunks)
    .where(inArray(chunks.documentId, docIds))
    .orderBy(chunks.documentId, chunks.ord);

  if (rows.length === 0) {
    throw new Error(
      'Nessun chunk trovato per i documenti indicati: sono stati estratti? (job extract_text)',
    );
  }

  return rows.map((r) => ({ docId: r.documentId, page: r.pageFrom, text: r.text }));
}

/** `jobKey = hash(type + scope + promptVersion + model)` (docs/fasi/F3-ai-core.md "Decisioni"). */
export function computeJobKey(parts: Record<string, unknown>): string {
  const canonical = JSON.stringify(parts, Object.keys(parts).sort());
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Idempotency lookup: a previous *successful* job with the same key means
 * "rerunning this returns the existing artifact instead of re-spending."
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function findIdempotentArtifactId(db: any, jobKey: string): Promise<string | null> {
  const [existing] = await db
    .select({ output: jobs.output })
    .from(jobs)
    .where(and(eq(jobs.jobKey, jobKey), eq(jobs.status, 'succeeded')))
    .orderBy(sql`${jobs.createdAt} desc`)
    .limit(1);

  const artifactId = (existing?.output as { artifactId?: string } | undefined)?.artifactId;
  return artifactId ?? null;
}

const AI_JOB_TYPES = [
  'generate_flashcards',
  'generate_schema',
  'generate_summary',
  'extract_exam_profile',
  'generate_simulation',
  'grade_attempt',
  'generate_plan',
  'extract_topics',
] as const;

/**
 * Budget guard (docs/fasi/F3-ai-core.md "Decisioni"): reads a daily cap from
 * `settings['budget.dailyCapEur']` (no cap configured = no guard). Sums
 * today's successful AI-job costs and throws if adding this job would
 * exceed it, unless the caller passed `force`.
 */
export async function checkBudget(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  estimatedCostEur: number,
  force: boolean,
): Promise<void> {
  if (force) return;

  const [row] = await db.select().from(settings).where(eq(settings.key, 'budget.dailyCapEur'));
  const cap = typeof row?.value === 'number' ? row.value : null;
  if (cap === null) return;

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const todaysJobs: { cost: JobCost | null }[] = await db
    .select({ cost: jobs.cost })
    .from(jobs)
    .where(
      and(
        inArray(jobs.type, AI_JOB_TYPES as unknown as string[]),
        eq(jobs.status, 'succeeded'),
        gte(jobs.createdAt, startOfDay),
      ),
    );
  const spent = todaysJobs.reduce((sum, j) => sum + (j.cost?.eur ?? 0), 0);

  if (spent + estimatedCostEur > cap) {
    throw new BudgetExceededError(cap, spent, estimatedCostEur);
  }
}

// docs/03-ai-e-worker.md §3.1 / docs/fasi/F3-ai-core.md "Non implementato": above this cosine
// similarity, two flashcard fronts are treated as the same fact restated, not two different cards.
const SEMANTIC_DUPLICATE_THRESHOLD = 0.92;

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Semantic dedup against the subject's already-embedded flashcards, plus the rest of the current
 * batch (docs/fasi/F3-ai-core.md "Non implementato": exact-text dedup only, "serve embeddings, non
 * ancora collegati" — F1 wired them in since). Runs *after* the exact-text dedup already in
 * `processGenerateFlashcards`, so it only ever has to catch paraphrases, not literal repeats.
 *
 * A card whose citation reuses a chunk close to an existing card's is exactly the case this is
 * for — two generation runs over overlapping scope shouldn't keep restating the same fact as a
 * "new" card. Cards without a stored `embedding` yet (created before this feature shipped) are
 * simply never compared against — no bulk backfill runs here, that would be a surprising side
 * effect of an ordinary generation call.
 */
export async function dedupeSemanticFlashcards<T extends { front: string }>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  subjectId: string,
  cards: T[],
  embed: (texts: string[]) => Promise<number[][]>,
): Promise<{ accepted: (T & { embedding: number[] })[]; duplicateCount: number }> {
  if (cards.length === 0) return { accepted: [], duplicateCount: 0 };

  const existingRows: { embedding: number[] | null }[] = await db
    .select({ embedding: flashcards.embedding })
    .from(flashcards)
    .innerJoin(artifacts, eq(flashcards.deckId, artifacts.id))
    .where(and(eq(artifacts.subjectId, subjectId), isNotNull(flashcards.embedding)));

  const pool: number[][] = existingRows.map((r) => r.embedding!);
  const newEmbeddings = await embed(cards.map((c) => c.front));

  const accepted: (T & { embedding: number[] })[] = [];
  let duplicateCount = 0;
  for (let i = 0; i < cards.length; i++) {
    const vector = newEmbeddings[i]!;
    const isDuplicate = pool.some(
      (existing) => cosineSimilarity(existing, vector) > SEMANTIC_DUPLICATE_THRESHOLD,
    );
    if (isDuplicate) {
      duplicateCount += 1;
      continue;
    }
    accepted.push({ ...cards[i]!, embedding: vector });
    pool.push(vector);
  }
  return { accepted, duplicateCount };
}
