import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { errorResponse } from '@/lib/http';
import { markVerifyItemUnknown } from '@/lib/verify';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string; sessionId: string; itemId: string }> };

/** «Non me lo ricordo»: la domanda passa a `unknown`, senza AI. Risponde con lo stato della verifica. */
export async function POST(_request: Request, { params }: RouteParams) {
  const { slug, sessionId, itemId } = await params;
  try {
    return NextResponse.json(await markVerifyItemUnknown(getDb(), slug, sessionId, itemId));
  } catch (err) {
    return errorResponse(err);
  }
}
