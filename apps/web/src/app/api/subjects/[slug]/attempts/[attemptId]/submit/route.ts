import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getJobQueue } from '@/lib/queue';
import { submitAttempt } from '@/lib/examPrep';
import { errorResponse } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ slug: string; attemptId: string }> },
) {
  const { slug, attemptId } = await params;
  try {
    return NextResponse.json({
      attempt: await submitAttempt(getDb(), getJobQueue(), slug, attemptId),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
