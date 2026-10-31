import { NextResponse } from 'next/server';
import { StartSprintTheoryRequestSchema } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import { getJobQueue } from '@/lib/queue';
import { errorResponse, parseBody } from '@/lib/http';
import { startSprintTheory } from '@/lib/sprint';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string; sessionId: string }> };

/**
 * Accoda i blocchi di teoria dei concetti degli esercizi sbagliati o "non so" (idempotente):
 * `{ jobIds, blockCount }`. I blocchi si leggono da `GET .../lesson`.
 */
export async function POST(request: Request, { params }: RouteParams) {
  const { slug, sessionId } = await params;
  // Body is optional: a bare POST uses the defaults.
  const hasBody = (await request.clone().text()).trim().length > 0;
  const body = await parseBody(
    hasBody ? request : new Request(request.url, { method: 'POST', body: '{}' }),
    StartSprintTheoryRequestSchema,
  );
  if (body.error) return body.error;
  try {
    const result = await startSprintTheory(getDb(), getJobQueue(), slug, sessionId, body.data);
    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    return errorResponse(err);
  }
}
