import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { errorResponse } from '@/lib/http';
import { retryVerify } from '@/lib/verify';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string; sessionId: string }> };

/** «Rifalla»: le domande non giuste ripartono nella stessa sessione. Sessione terminata: 409. */
export async function POST(_request: Request, { params }: RouteParams) {
  const { slug, sessionId } = await params;
  try {
    return NextResponse.json(await retryVerify(getDb(), slug, sessionId));
  } catch (err) {
    return errorResponse(err);
  }
}
