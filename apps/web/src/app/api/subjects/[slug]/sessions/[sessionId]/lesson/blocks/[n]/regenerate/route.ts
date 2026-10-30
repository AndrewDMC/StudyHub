import { NextResponse } from 'next/server';
import { RegenerateLessonBlockRequestSchema } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import { getJobQueue } from '@/lib/queue';
import { errorResponse, parseBody } from '@/lib/http';
import { InvalidRequestError } from '@/lib/examPrep';
import { regenerateLessonBlock } from '@/lib/lesson';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string; sessionId: string; n: string }> };

/** «Rispiegamelo in un altro modo»: accoda la rigenerazione del blocco `n`; il blocco resta finché il nuovo non lo sostituisce. */
export async function POST(request: Request, { params }: RouteParams) {
  const { slug, sessionId, n } = await params;
  const blockIndex = Number(n);
  if (!Number.isInteger(blockIndex) || blockIndex < 0) {
    return errorResponse(new InvalidRequestError('Blocco non valido'));
  }
  // Body is optional: a bare POST uses the defaults.
  const hasBody = (await request.clone().text()).trim().length > 0;
  const body = await parseBody(
    hasBody ? request : new Request(request.url, { method: 'POST', body: '{}' }),
    RegenerateLessonBlockRequestSchema,
  );
  if (body.error) return body.error;
  try {
    const result = await regenerateLessonBlock(
      getDb(),
      getJobQueue(),
      slug,
      sessionId,
      blockIndex,
      body.data,
    );
    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    return errorResponse(err);
  }
}
