import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { jobs, subjects, type Job, type JobCost } from '@studyhub/db';
import type {
  AdminJobsQuery,
  AdminJobsResponse,
  AdminOverviewDto,
  FsSyncStatusDto,
  MonthlyCostDto,
  RecentJobDto,
} from '@studyhub/contracts';
import type { Queue } from 'bullmq';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

function toJobDto(job: Job, subjectSlug: string | null, subjectName: string | null): RecentJobDto {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    subjectSlug,
    subjectName,
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
    costEur: job.cost?.eur ?? null,
    errorMessage: (job.error as { message?: string } | null)?.message ?? null,
  };
}

/** Job list for `/admin` — same shape as the dashboard's "Attività" feed, paginated and status-filterable. */
export async function listAdminJobs(db: AnyDb, query: AdminJobsQuery): Promise<AdminJobsResponse> {
  const where = query.status ? eq(jobs.status, query.status) : undefined;

  const rows: { job: Job; subjectSlug: string | null; subjectName: string | null }[] = await db
    .select({ job: jobs, subjectSlug: subjects.slug, subjectName: subjects.name })
    .from(jobs)
    .leftJoin(subjects, eq(jobs.subjectId, subjects.id))
    .where(where)
    .orderBy(desc(jobs.createdAt))
    .limit(query.limit)
    .offset(query.offset);

  const countRows: { id: string }[] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(where);

  return {
    jobs: rows.map((r) => toJobDto(r.job, r.subjectSlug, r.subjectName)),
    total: countRows.length,
  };
}

/** UTC `YYYY-MM` of a job's `createdAt`, in JS since `cost` is jsonb (no SQL-level sum available). */
function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function getCostsByMonth(db: AnyDb): Promise<MonthlyCostDto[]> {
  const rows: { createdAt: Date; cost: JobCost | null }[] = await db
    .select({ createdAt: jobs.createdAt, cost: jobs.cost })
    .from(jobs);

  const byMonth = new Map<string, { costEur: number; jobCount: number }>();
  for (const row of rows) {
    if (!row.cost) continue;
    const key = monthKey(row.createdAt);
    const entry = byMonth.get(key) ?? { costEur: 0, jobCount: 0 };
    entry.costEur += row.cost.eur;
    entry.jobCount += 1;
    byMonth.set(key, entry);
  }

  return [...byMonth.entries()]
    .sort(([a], [b]) => b.localeCompare(a)) // newest month first
    .map(([month, v]) => ({ month, costEur: Math.round(v.costEur * 1_000_000) / 1_000_000, jobCount: v.jobCount }));
}

async function getFsSyncStatus(db: AnyDb): Promise<FsSyncStatusDto> {
  const [lastReconcile] = await db
    .select()
    .from(jobs)
    .where(eq(jobs.type, 'reconcile'))
    .orderBy(desc(jobs.createdAt))
    .limit(1);

  if (!lastReconcile) {
    return { lastRunAt: null, status: null, imported: [], alreadyIndexed: [], skippedInvalid: [] };
  }

  const output = (lastReconcile.output ?? {}) as {
    imported?: string[];
    alreadyIndexed?: string[];
    skippedInvalid?: { slug: string; reason: string }[];
  };
  return {
    lastRunAt: lastReconcile.createdAt.toISOString(),
    status: lastReconcile.status,
    imported: output.imported ?? [],
    alreadyIndexed: output.alreadyIndexed ?? [],
    skippedInvalid: output.skippedInvalid ?? [],
  };
}

/** `/admin` overview: costs per month + last filesystem sync (docs/fasi/F7-dashboard-polish.md scope). */
export async function getAdminOverview(db: AnyDb): Promise<AdminOverviewDto> {
  const [costsByMonth, fsSync] = await Promise.all([getCostsByMonth(db), getFsSyncStatus(db)]);
  return { costsByMonth, fsSync };
}

/**
 * "Reset indice" (docs/fasi/F7-dashboard-polish.md scope): re-runs the same `reconcile` a full
 * data-root scan does at worker startup (`apps/worker/src/index.ts`) — idempotent (imports what's
 * missing, never touches what's already indexed), not a destructive wipe-and-rebuild.
 */
export async function enqueueReconcile(
  queue: Pick<Queue, 'add'>,
): Promise<{ jobId: string }> {
  const jobId = randomUUID();
  await queue.add('reconcile', {}, { jobId });
  return { jobId };
}
