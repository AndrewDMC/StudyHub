import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { jobs, subjects } from '@studyhub/db';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Status of an `extract_topics` job, so the panel can show its outcome (or failure) instead of guessing. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; jobId: string }> },
) {
  const { slug, jobId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: 'jobId non valido' } },
      { status: 400 },
    );
  }
  const db = getDb();
  const [row] = await db
    .select({ status: jobs.status, output: jobs.output, error: jobs.error })
    .from(jobs)
    .innerJoin(subjects, eq(jobs.subjectId, subjects.id))
    .where(and(eq(jobs.id, jobId), eq(subjects.slug, slug), eq(jobs.type, 'extract_topics')));
  // No row yet = still waiting in the queue for the worker to pick it up.
  if (!row) return NextResponse.json({ status: 'queued' });
  return NextResponse.json({
    status: row.status,
    output: row.output ?? null,
    error: (row.error as { message?: string } | null)?.message ?? null,
  });
}
