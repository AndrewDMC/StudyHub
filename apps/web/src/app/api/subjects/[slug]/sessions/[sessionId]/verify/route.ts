import { NextResponse } from 'next/server';
import { StartVerifyRequestSchema } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import { getJobQueue } from '@/lib/queue';
import { errorResponse, parseBody } from '@/lib/http';
import { getVerifyState, startVerify } from '@/lib/verify';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string; sessionId: string }> };

/** Lo stato della verifica: domande, esiti, job di generazione e riepilogo (`VerifyStateDto`). */
export async function GET(_request: Request, { params }: RouteParams) {
  const { slug, sessionId } = await params;
  try {
    return NextResponse.json(await getVerifyState(getDb(), slug, sessionId));
  } catch (err) {
    return errorResponse(err);
  }
}

/** Riprova a preparare le domande (idempotente): `{ jobId }`, `null` se non c'è nulla da generare. */
export async function POST(request: Request, { params }: RouteParams) {
  const { slug, sessionId } = await params;
  const hasBody = (await request.clone().text()).trim().length > 0;
  const body = await parseBody(
    hasBody ? request : new Request(request.url, { method: 'POST', body: '{}' }),
    StartVerifyRequestSchema,
  );
  if (body.error) return body.error;
  try {
    const result = await startVerify(getDb(), getJobQueue(), slug, sessionId, body.data);
    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    return errorResponse(err);
  }
}
