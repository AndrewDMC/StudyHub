import { NextResponse } from 'next/server';
import { getDataRoot } from '@/lib/dataRoot';
import { getDb } from '@/lib/db';
import { errorResponse } from '@/lib/http';
import { createDrillFromWrongExercises } from '@/lib/sessionClosing';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string; sessionId: string }> };

/** «Aggiungi gli esercizi sbagliati ai drill»: gratis, solo a sessione terminata. */
export async function POST(_request: Request, { params }: RouteParams) {
  const { slug, sessionId } = await params;
  try {
    const drill = await createDrillFromWrongExercises(getDb(), getDataRoot(), slug, sessionId);
    return NextResponse.json(drill, { status: drill.created ? 201 : 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
