import { desc, eq } from 'drizzle-orm';
import { jobs, subjects, type Job } from '@studyhub/db';
import type { RecentJobDto } from '@studyhub/contracts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

function toDto(job: Job, subjectSlug: string | null, subjectName: string | null): RecentJobDto {
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

/** "Attività" (docs/fasi/F7-dashboard-polish.md §6): most recent jobs across every subject, newest first. */
export async function getRecentJobs(db: AnyDb, limit = 10): Promise<RecentJobDto[]> {
  const rows: { job: Job; subjectSlug: string | null; subjectName: string | null }[] = await db
    .select({ job: jobs, subjectSlug: subjects.slug, subjectName: subjects.name })
    .from(jobs)
    .leftJoin(subjects, eq(jobs.subjectId, subjects.id))
    .orderBy(desc(jobs.createdAt))
    .limit(limit);
  return rows.map((r) => toDto(r.job, r.subjectSlug, r.subjectName));
}
