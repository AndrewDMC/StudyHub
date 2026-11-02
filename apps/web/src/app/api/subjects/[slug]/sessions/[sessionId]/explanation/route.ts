import { NextResponse } from 'next/server';
import { SubmitExplanationRequestSchema } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import { getJobQueue } from '@/lib/queue';
import { errorResponse, parseBody } from '@/lib/http';
import { getExplanation, submitExplanation } from '@/lib/explanation';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string; sessionId: string }> };

/** L'ultima spiegazione con il suo confronto e lo stato del job (`ExplanationStateDto`). */
export async function GET(_request: Request, { params }: RouteParams) {
  const { slug, sessionId } = await params;
  try {
    return NextResponse.json(await getExplanation(getDb(), slug, sessionId));
  } catch (err) {
    return errorResponse(err);
  }
}

/** Invia la spiegazione e accoda il confronto con il materiale: `{ itemId, jobId }`. */
export async function POST(request: Request, { params }: RouteParams) {
  const { slug, sessionId } = await params;
  const body = await parseBody(request, SubmitExplanationRequestSchema);
  if (body.error) return body.error;
  try {
    const result = await submitExplanation(getDb(), getJobQueue(), slug, sessionId, body.data);
    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    return errorResponse(err);
  }
}
