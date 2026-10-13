import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { ReviewNotFoundError, ReviewNotUndoableError, undoReview } from '@/lib/review';
import { formatError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

/** Undoes a rating (docs/09-ripasso-mobile.md §B3): 409 unless it is the card's latest one. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ reviewId: string }> },
) {
  const { reviewId } = await params;
  try {
    const flashcard = await undoReview(getDb(), reviewId);
    return NextResponse.json({ flashcard });
  } catch (err) {
    if (err instanceof ReviewNotFoundError) {
      return NextResponse.json(
        { error: { code: 'review_not_found', message: err.message } },
        { status: 404 },
      );
    }
    if (err instanceof ReviewNotUndoableError) {
      return NextResponse.json(
        { error: { code: 'review_not_undoable', message: err.message } },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: { code: 'internal_error', message: formatError(err) } },
      { status: 500 },
    );
  }
}
