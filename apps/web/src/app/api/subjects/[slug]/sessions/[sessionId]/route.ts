import { NextResponse } from 'next/server';
import { UpdateSessionRequestSchema } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import { errorResponse, parseBody } from '@/lib/http';
import { getSession, updateSession } from '@/lib/sessions';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string; sessionId: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const { slug, sessionId } = await params;
  try {
    const session = await getSession(getDb(), slug, sessionId);
    return NextResponse.json({ session });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Cambia gli argomenti (ricalcola i documenti) e/o registra il tempo attivo (heartbeat del timer). */
export async function PATCH(request: Request, { params }: RouteParams) {
  const { slug, sessionId } = await params;
  const body = await parseBody(request, UpdateSessionRequestSchema);
  if (body.error) return body.error;
  try {
    const session = await updateSession(getDb(), slug, sessionId, body.data);
    return NextResponse.json({ session });
  } catch (err) {
    return errorResponse(err);
  }
}
