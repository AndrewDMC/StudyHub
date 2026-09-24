import { createHash } from 'node:crypto';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { chunks, documents, jobs, settings, type JobCost } from '@studyhub/db';
import type { GenerationScope } from '@studyhub/contracts';
import type { ChunkRef } from '@studyhub/ai';

export class ScopeNotSupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScopeNotSupportedError';
  }
}

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
 * Resolves a generation scope to the chunks it covers. Only `docIds` is
 * implemented: `topicIds` needs a `document_topics` tagging table that
 * doesn't exist yet (docs/fasi/F3-ai-core.md "Stato" addendum) — accepted by
 * the contract schema for forward compatibility, but rejected here with a
 * clear message rather than silently resolving to nothing or to everything.
 */
export async function resolveScopeChunks(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  subjectId: string,
  scope: GenerationScope,
): Promise<ChunkRef[]> {
  if (!scope.docIds || scope.docIds.length === 0) {
    throw new ScopeNotSupportedError(
      'Scope per topicIds non ancora supportato: manca il tagging documento->argomento (F3+).',
    );
  }

  const docRows: { id: string; subjectId: string }[] = await db
    .select({ id: documents.id, subjectId: documents.subjectId })
    .from(documents)
    .where(inArray(documents.id, scope.docIds));

  const foundIds = new Set(docRows.map((d) => d.id));
  const missing = scope.docIds.filter((id) => !foundIds.has(id));
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
    .where(inArray(chunks.documentId, scope.docIds))
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
  'generate_summary',
  'extract_exam_profile',
  'generate_simulation',
  'grade_attempt',
  'generate_plan',
] as const;

/**
 * Budget guard (docs/fasi/F3-ai-core.md "Decisioni"): reads a daily cap from
 * `settings['budget.dailyCapEur']` (no cap configured = no guard). Sums
 * today's successful AI-job costs and throws if adding this job would
 * exceed it, unless the caller passed `force`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function checkBudget(
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
