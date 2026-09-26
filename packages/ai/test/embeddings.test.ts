import { describe, expect, it } from 'vitest';
import { embedText, embedTexts, EMBEDDING_DIMENSIONS } from '../src/embeddings.js';

describe('embedText (local Xenova/all-MiniLM-L6-v2)', () => {
  it('returns a 384-dim, L2-normalized vector', async () => {
    const vec = await embedText('Il primo principio della termodinamica');
    expect(vec).toHaveLength(EMBEDDING_DIMENSIONS);
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1, 1);
  }, 60_000);

  it('is deterministic for the same input', async () => {
    const a = await embedText('entropia');
    const b = await embedText('entropia');
    expect(a).toEqual(b);
  }, 60_000);

  it('places semantically similar sentences closer than unrelated ones (cosine similarity)', async () => {
    const [a, b, c] = await embedTexts([
      'Heat is a form of energy in transit between two systems',
      'Temperature measures the thermal energy stored in a system',
      'The cat is sleeping on the couch all afternoon',
    ]);
    const cos = (x: number[], y: number[]) => x.reduce((s, v, i) => s + v * (y[i] ?? 0), 0);
    expect(cos(a!, b!)).toBeGreaterThan(cos(a!, c!));
  }, 60_000);
});
