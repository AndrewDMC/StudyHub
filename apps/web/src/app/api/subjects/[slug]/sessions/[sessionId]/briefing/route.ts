import { NextResponse } from 'next/server';
import { StartBriefingRequestSchema } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import { getJobQueue } from '@/lib/queue';
import { errorResponse, parseBody } from '@/lib/http';
import { getBriefing, startBriefing } from '@/lib/sessionBriefing';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string; sessionId: string }> };

/** Punti chiave ed esercizi della sessione, con lo stato dell'ultimo job di generazione. */
export async function GET(_request: Request, { params }: RouteParams) {
  const { slug, sessionId } = await params;
  try {
    return NextResponse.json(await getBriefing(getDb(), slug, sessionId));
  } catch (err) {
    return errorResponse(err);
  }
}

/** Avvia `prepare_session`: solo su richiesta dell'utente (docs/08-sessione-di-studio.md decisione 3). */
export async function POST(request: Request, { params }: RouteParams) {
  const { slug, sessionId } = await params;
  const body = await parseBody(request, StartBriefingRequestSchema);
  if (body.error) return body.error;
  try {
    const result = await startBriefing(getDb(), getJobQueue(), slug, sessionId, body.data);
    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    return errorResponse(err);
  }
}
