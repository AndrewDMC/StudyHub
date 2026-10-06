import { NextResponse } from 'next/server';
import { UpdateSessionItemRequestSchema } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import { errorResponse, parseBody } from '@/lib/http';
import { updateSessionItem } from '@/lib/sessionBriefing';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string; sessionId: string; itemId: string }> };

/** Spunta un punto chiave, oppure salva la risposta / l'autovalutazione di un esercizio. */
export async function PATCH(request: Request, { params }: RouteParams) {
  const { slug, sessionId, itemId } = await params;
  const body = await parseBody(request, UpdateSessionItemRequestSchema);
  if (body.error) return body.error;
  try {
    const item = await updateSessionItem(getDb(), slug, sessionId, itemId, body.data);
    return NextResponse.json({ item });
  } catch (err) {
    return errorResponse(err);
  }
}
