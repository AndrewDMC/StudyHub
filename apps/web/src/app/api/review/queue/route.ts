import { NextResponse } from 'next/server';
import { ReviewQueueQuerySchema } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import { getQuickReviewQueue } from '@/lib/review';
import { formatError, SubjectNotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

/**
 * Ripasso rapido queue (docs/09-ripasso-mobile.md §B2): `materia` and `argomento` narrow it
 * (`argomento=none` = cards without a topic), `n` caps it; without `materia` it spans every
 * active subject.
 */
export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = ReviewQueueQuerySchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'invalid_request',
          message: parsed.error.issues[0]?.message ?? 'Richiesta non valida',
        },
      },
      { status: 400 },
    );
  }
  const { materia, argomento, n } = parsed.data;

  try {
    const queue = await getQuickReviewQueue(
      getDb(),
      { subjectSlug: materia, topicId: argomento === 'none' ? null : argomento },
      { n },
    );
    return NextResponse.json({ queue });
  } catch (err) {
    if (err instanceof SubjectNotFoundError) {
      return NextResponse.json(
        { error: { code: 'subject_not_found', message: err.message } },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: { code: 'internal_error', message: formatError(err) } },
      { status: 500 },
    );
  }
}
