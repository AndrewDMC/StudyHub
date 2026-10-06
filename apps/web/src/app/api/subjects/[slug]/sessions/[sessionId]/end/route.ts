import { NextResponse } from 'next/server';
import { EndSessionRequestSchema } from '@studyhub/contracts';
import { getDataRoot } from '@/lib/dataRoot';
import { getDb } from '@/lib/db';
import { errorResponse, parseBody } from '@/lib/http';
import { endSession } from '@/lib/sessions';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string; sessionId: string }> };

/** "Termina": chiude la sessione, porta la task collegata a `done` e scrive la trascrizione della chat. */
export async function POST(request: Request, { params }: RouteParams) {
  const { slug, sessionId } = await params;
  const body = await parseBody(request, EndSessionRequestSchema);
  if (body.error) return body.error;
  try {
    const session = await endSession(getDb(), slug, sessionId, body.data, {
      dataRoot: getDataRoot(),
    });
    return NextResponse.json({ session });
  } catch (err) {
    return errorResponse(err);
  }
}
