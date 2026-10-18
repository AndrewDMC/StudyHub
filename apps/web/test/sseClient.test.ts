import { describe, expect, it } from 'vitest';
import { readSse } from '../src/lib/sseClient';

function sse(chunks: string[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(stream);
}

describe('readSse', () => {
  it('parses events split across chunks', async () => {
    const events: unknown[] = [];
    await readSse(
      sse(['data: {"type":"delta","text":"a"}\n\ndata: {"ty', 'pe":"done"}\n\n']),
      (e) => events.push(e),
    );
    expect(events).toEqual([{ type: 'delta', text: 'a' }, { type: 'done' }]);
  });

  it('ignores blocks without a data line and trailing partial blocks', async () => {
    const events: unknown[] = [];
    await readSse(sse([': ping\n\ndata: {"n":1}\n\ndata: {"n":2}']), (e) => events.push(e));
    expect(events).toEqual([{ n: 1 }]);
  });

  it('handles multi-byte characters split across chunks', async () => {
    const bytes = new TextEncoder().encode('data: {"t":"è"}\n\n');
    const res = new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(bytes.slice(0, 11));
          c.enqueue(bytes.slice(11));
          c.close();
        },
      }),
    );
    const events: unknown[] = [];
    await readSse(res, (e) => events.push(e));
    expect(events).toEqual([{ t: 'è' }]);
  });
});
