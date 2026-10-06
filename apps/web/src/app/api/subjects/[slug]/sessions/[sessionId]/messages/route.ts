import { NextResponse } from 'next/server';
import { resolveProvider } from '@studyhub/ai';
import { SendSessionMessageRequestSchema, type SessionChatEvent } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import { errorResponse, parseBody } from '@/lib/http';
import { getSessionChat, startChatTurn } from '@/lib/sessionChat';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string; sessionId: string }> };

/** La conversazione finora e il suo costo cumulativo. */
export async function GET(_request: Request, { params }: RouteParams) {
  const { slug, sessionId } = await params;
  try {
    return NextResponse.json(await getSessionChat(getDb(), slug, sessionId));
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * Una domanda al tutor, con risposta in streaming (SSE, un evento JSON per riga `data:`).
 * Non passa dalla coda: l'utente aspetta la risposta (docs/08-sessione-di-studio.md §5.3).
 * Sessione inesistente o terminata → errore HTTP normale, prima che lo stream cominci.
 */
export async function POST(request: Request, { params }: RouteParams) {
  const { slug, sessionId } = await params;
  const body = await parseBody(request, SendSessionMessageRequestSchema);
  if (body.error) return body.error;

  let turn;
  try {
    turn = await startChatTurn(getDb(), slug, sessionId, body.data, resolveProvider());
  } catch (err) {
    return errorResponse(err);
  }

  const encoder = new TextEncoder();
  const send = (controller: ReadableStreamDefaultController<Uint8Array>, event: SessionChatEvent) =>
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

  const events = turn.run();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      send(controller, { type: 'user', message: turn.userMessage });
      try {
        for await (const event of events) send(controller, event);
      } finally {
        controller.close();
      }
    },
    // The student closed the tab or hit "stop": let the provider stop paying for tokens.
    async cancel() {
      await events.return(undefined);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
