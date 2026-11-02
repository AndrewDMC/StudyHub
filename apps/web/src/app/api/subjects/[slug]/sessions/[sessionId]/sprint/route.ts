import { NextResponse } from 'next/server';
import { StartSprintRequestSchema } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import { getJobQueue } from '@/lib/queue';
import { errorResponse, parseBody } from '@/lib/http';
import { getSprint, startSprint } from '@/lib/sprint';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string; sessionId: string }> };

/** Lo stato della lezione sprint: esercizi, riprove, teoria, job e costo (`SprintDto`). */
export async function GET(_request: Request, { params }: RouteParams) {
  const { slug, sessionId } = await params;
  try {
    return NextResponse.json(await getSprint(getDb(), slug, sessionId));
  } catch (err) {
    return errorResponse(err);
  }
}

/** Accoda la generazione dei 3 esercizi (idempotente): `{ jobId }`, `null` se ci sono già. */
export async function POST(request: Request, { params }: RouteParams) {
  const { slug, sessionId } = await params;
  // Body is optional: a bare POST uses the defaults.
  const hasBody = (await request.clone().text()).trim().length > 0;
  const body = await parseBody(
    hasBody ? request : new Request(request.url, { method: 'POST', body: '{}' }),
    StartSprintRequestSchema,
  );
  if (body.error) return body.error;
  try {
    const result = await startSprint(getDb(), getJobQueue(), slug, sessionId, body.data);
    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    return errorResponse(err);
  }
}
