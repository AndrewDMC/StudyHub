import { NextResponse } from 'next/server';
import { UpdateFlashcardRequestSchema } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import { deleteFlashcard, updateFlashcard } from '@/lib/deckEditor';
import { errorResponse, parseBody } from '@/lib/http';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string; cardId: string }> };

/**
 * Edits one card: front/back/type/hint, topic, deck, tags, suspend ("sospendo una card: sparisce
 * dalla coda ma resta nel deck") and flag ("segnala card scadente") — docs/fasi/F4-flashcard.md.
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  const { slug, cardId } = await params;
  const { data, error } = await parseBody(request, UpdateFlashcardRequestSchema);
  if (error) return error;
  try {
    return NextResponse.json({ flashcard: await updateFlashcard(getDb(), slug, cardId, data) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { slug, cardId } = await params;
  try {
    await deleteFlashcard(getDb(), slug, cardId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
