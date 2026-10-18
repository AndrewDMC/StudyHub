import { resolveProvider } from '@studyhub/ai';
import { AskSubjectRequestSchema, type AskSubjectEvent } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import { errorResponse, parseBody } from '@/lib/http';
import { askSubject } from '@/lib/subjectAsk';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string }> };

/**
 * "Chiedi" sulla materia: una domanda, risposta in streaming (SSE, un evento JSON per riga `data:`:
 * delta, poi done {answer, citations} oppure error). Nessuno storico. Errori prima dello stream:
 * 404 materia, 400 body/id non della materia, 429 budget giornaliero.
 */
export async function POST(request: Request, { params }: RouteParams) {
  const { slug } = await params;
  const body = await parseBody(request, AskSubjectRequestSchema);
  if (body.error) return body.error;

  let ask;
  try {
    ask = await askSubject(getDb(), slug, body.data, resolveProvider());
  } catch (err) {
    return errorResponse(err);
  }

  const encoder = new TextEncoder();
  const send = (controller: ReadableStreamDefaultController<Uint8Array>, event: AskSubjectEvent) =>
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

  const events = ask.run();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of events) send(controller, event);
      } finally {
        controller.close();
      }
    },
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
