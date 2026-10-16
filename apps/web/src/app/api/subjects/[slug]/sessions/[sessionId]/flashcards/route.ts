import { NextResponse } from 'next/server';
import { CreateKeyPointDeckRequestSchema } from '@studyhub/contracts';
import { getDataRoot } from '@/lib/dataRoot';
import { getDb } from '@/lib/db';
import { errorResponse, parseBody } from '@/lib/http';
import { createKeyPointDeck } from '@/lib/sessionClosing';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string; sessionId: string }> };

/** «Crea flashcard dai punti chiave»: gratis (nessuna chiamata AI), solo a sessione terminata. */
export async function POST(request: Request, { params }: RouteParams) {
  const { slug, sessionId } = await params;
  // Il body è opzionale: assente o vuoto = tutti i punti chiave (comportamento storico).
  const raw = await request.text();
  let itemIds: string[] | undefined;
  if (raw.trim() !== '') {
    const body = await parseBody(
      new Request(request.url, { method: 'POST', body: raw }),
      CreateKeyPointDeckRequestSchema,
    );
    if (body.error) return body.error;
    itemIds = body.data.itemIds;
  }
  try {
    const deck = await createKeyPointDeck(getDb(), getDataRoot(), slug, sessionId, itemIds);
    return NextResponse.json(deck, { status: deck.created ? 201 : 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
