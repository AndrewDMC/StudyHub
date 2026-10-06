import { NextResponse } from 'next/server';
import { getDataRoot } from '@/lib/dataRoot';
import { getDb } from '@/lib/db';
import { errorResponse } from '@/lib/http';
import { readSessionTranscript } from '@/lib/sessionChat';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string; sessionId: string }> };

/** La trascrizione Markdown della chat, scritta alla chiusura della sessione (null se non c'è). */
export async function GET(_request: Request, { params }: RouteParams) {
  const { slug, sessionId } = await params;
  try {
    const markdown = await readSessionTranscript(getDb(), getDataRoot(), slug, sessionId);
    return NextResponse.json({ markdown });
  } catch (err) {
    return errorResponse(err);
  }
}
