/**
 * Reads an SSE response body (`data: {json}` lines separated by a blank line) and calls `onEvent` with
 * each parsed event. The response must already be checked (`ok`, `body`) by the caller.
 */
export async function readSse<T>(res: Response, onEvent: (event: T) => void): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    let end = buffered.indexOf('\n\n');
    while (end >= 0) {
      const line = buffered
        .slice(0, end)
        .split('\n')
        .find((l) => l.startsWith('data: '));
      buffered = buffered.slice(end + 2);
      if (line) onEvent(JSON.parse(line.slice(6)) as T);
      end = buffered.indexOf('\n\n');
    }
  }
}
