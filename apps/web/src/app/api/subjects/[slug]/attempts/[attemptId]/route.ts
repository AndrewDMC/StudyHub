import { NextResponse } from 'next/server';
import { SaveAnswersRequestSchema } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import { getJobQueue } from '@/lib/queue';
import { getAttempt, saveAnswers } from '@/lib/examPrep';
import { errorResponse, parseBody } from '@/lib/http';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string; attemptId: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const { slug, attemptId } = await params;
  try {
    return NextResponse.json({
      attempt: await getAttempt(getDb(), getJobQueue(), slug, attemptId),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Autosave (409 once the time is up or the exam was handed in). */
export async function PATCH(request: Request, { params }: RouteParams) {
  const { slug, attemptId } = await params;
  const body = await parseBody(request, SaveAnswersRequestSchema);
  if (body.error) return body.error;
  try {
    const attempt = await saveAnswers(getDb(), getJobQueue(), slug, attemptId, body.data.answers);
    return NextResponse.json({ attempt });
  } catch (err) {
    return errorResponse(err);
  }
}
