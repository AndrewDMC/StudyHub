import { NextResponse } from 'next/server';
import { EndSessionRequestSchema } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import { errorResponse, parseBody } from '@/lib/http';
import { endSession } from '@/lib/sessions';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string; sessionId: string }> };

/** "Termina": chiude la sessione e porta la task collegata a `done`. */
export async function POST(request: Request, { params }: RouteParams) {
  const { slug, sessionId } = await params;
  const body = await parseBody(request, EndSessionRequestSchema);
  if (body.error) return body.error;
  try {
    const session = await endSession(getDb(), slug, sessionId, body.data);
    return NextResponse.json({ session });
  } catch (err) {
    return errorResponse(err);
  }
}
