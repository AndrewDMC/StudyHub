import { NextResponse } from 'next/server';
import { SetSessionMoodRequestSchema } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import { errorResponse, parseBody } from '@/lib/http';
import { setSessionMood } from '@/lib/sessions';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string; sessionId: string }> };

/** «Com'è andata?» in chiusura: salva (o toglie con `null`) il mood di una sessione già terminata. */
export async function PATCH(request: Request, { params }: RouteParams) {
  const { slug, sessionId } = await params;
  const body = await parseBody(request, SetSessionMoodRequestSchema);
  if (body.error) return body.error;
  try {
    const session = await setSessionMood(getDb(), slug, sessionId, body.data.mood);
    return NextResponse.json({ session });
  } catch (err) {
    return errorResponse(err);
  }
}
