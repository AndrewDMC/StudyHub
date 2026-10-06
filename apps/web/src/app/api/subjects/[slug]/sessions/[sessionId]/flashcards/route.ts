import { NextResponse } from 'next/server';
import { getDataRoot } from '@/lib/dataRoot';
import { getDb } from '@/lib/db';
import { errorResponse } from '@/lib/http';
import { createKeyPointDeck } from '@/lib/sessionClosing';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string; sessionId: string }> };

/** «Crea flashcard dai punti chiave»: gratis (nessuna chiamata AI), solo a sessione terminata. */
export async function POST(_request: Request, { params }: RouteParams) {
  const { slug, sessionId } = await params;
  try {
    const deck = await createKeyPointDeck(getDb(), getDataRoot(), slug, sessionId);
    return NextResponse.json(deck, { status: deck.created ? 201 : 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
