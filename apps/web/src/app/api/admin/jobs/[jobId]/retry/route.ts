import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getJobQueue } from '@/lib/queue';
import { JobNotFoundError, JobNotRetryableError, retryJob } from '@/lib/admin';
import { formatError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ jobId: string }> };

/** `/admin` "Rilancia" on a failed job row (docs/fasi/F7-dashboard-polish.md scope). */
export async function POST(_request: Request, { params }: RouteParams) {
  const { jobId } = await params;
  try {
    const result = await retryJob(getDb(), getJobQueue(), jobId);
    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    if (err instanceof JobNotFoundError) {
      return NextResponse.json(
        { error: { code: 'job_not_found', message: err.message } },
        { status: 404 },
      );
    }
    if (err instanceof JobNotRetryableError) {
      return NextResponse.json(
        { error: { code: 'not_retryable', message: err.message } },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: { code: 'internal_error', message: formatError(err) } },
      { status: 500 },
    );
  }
}
