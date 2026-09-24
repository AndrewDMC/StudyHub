import { NextResponse } from 'next/server';
import { SubmitReviewRequestSchema } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import { FlashcardNotFoundError, submitReview } from '@/lib/review';
import { formatError, SubjectNotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

/** Submits one FSRS rating for a card (docs/fasi/F4-flashcard.md Modalità Review). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string; cardId: string }> },
) {
  const { slug, cardId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = SubmitReviewRequestSchema.safeParse(body);
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

  try {
    const flashcard = await submitReview(getDb(), slug, cardId, parsed.data);
    return NextResponse.json({ flashcard });
  } catch (err) {
    if (err instanceof SubjectNotFoundError) {
      return NextResponse.json(
        { error: { code: 'subject_not_found', message: err.message } },
        { status: 404 },
      );
    }
    if (err instanceof FlashcardNotFoundError) {
      return NextResponse.json(
        { error: { code: 'flashcard_not_found', message: err.message } },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: { code: 'internal_error', message: formatError(err) } },
      { status: 500 },
    );
  }
}
