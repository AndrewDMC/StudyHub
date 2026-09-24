import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getJobQueue } from '@/lib/queue';
import { startOrResumeAttempt } from '@/lib/examPrep';
import { errorResponse } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Starts exam mode on a simulation, or resumes the attempt already in progress. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ slug: string; simulationId: string }> },
) {
  const { slug, simulationId } = await params;
  try {
    const attempt = await startOrResumeAttempt(getDb(), getJobQueue(), slug, simulationId);
    return NextResponse.json({ attempt });
  } catch (err) {
    return errorResponse(err);
  }
}
