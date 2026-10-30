import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { getJobQueue } from '@/lib/queue';
import { errorResponse, parseBody } from '@/lib/http';
import { getLesson, startLesson } from '@/lib/lesson';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string; sessionId: string }> };

const StartLessonRequestSchema = z
  .object({
    model: z.string().min(1).max(100).optional(),
    force: z.boolean().default(false),
  })
  .default({});

/** I blocchi della lezione generati finora, con lo stato dell'ultimo job e il costo (`LessonDto`). */
export async function GET(_request: Request, { params }: RouteParams) {
  const { slug, sessionId } = await params;
  try {
    return NextResponse.json(await getLesson(getDb(), slug, sessionId));
  } catch (err) {
    return errorResponse(err);
  }
}

/** Accoda il blocco 0 se manca (idempotente): `{ jobId }`, `null` se non c'era nulla da fare. */
export async function POST(request: Request, { params }: RouteParams) {
  const { slug, sessionId } = await params;
  // Body is optional: a bare POST uses the defaults.
  const hasBody = (await request.clone().text()).trim().length > 0;
  const body = await parseBody(
    hasBody ? request : new Request(request.url, { method: 'POST', body: '{}' }),
    StartLessonRequestSchema,
  );
  if (body.error) return body.error;
  try {
    const result = await startLesson(getDb(), getJobQueue(), slug, sessionId, body.data);
    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    return errorResponse(err);
  }
}
