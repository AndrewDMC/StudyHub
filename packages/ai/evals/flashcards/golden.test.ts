import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { FakeProvider } from '../../src/fakeProvider.js';
import type { FlashcardsOutput } from '../../src/schemas.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Golden set for `generate_flashcards` (docs/03-ai-e-worker.md §6: "Ogni
 * prompt ha un golden set ... `pnpm eval flashcards` gira prima di ogni
 * bump di versione"). Runs against `FakeProvider` — it can't catch a real
 * model's judgment regressing, but it does catch the extraction/validation
 * pipeline itself regressing, and documents the quality bar every provider
 * (including a future real one) is expected to clear.
 *
 * Reduced scope vs. the "5-10 real documents" the doc asks for: 2 fixtures
 * across different subject domains (STEM + humanities), not a full corpus —
 * see docs/fasi/F3-ai-core.md "Stato" addendum.
 */
const FIXTURES = ['termodinamica.txt', 'diritto-costituzionale.txt'];

function assertQualityBar(output: FlashcardsOutput, sourceText: string) {
  expect(output.cards.length).toBeGreaterThan(0);

  const fronts = new Set<string>();
  for (const card of output.cards) {
    // Anti-hallucination: every citation must be a verbatim substring of the source.
    expect(sourceText).toContain(card.sourceRef.quote);
    // No exact-duplicate fronts within one deck.
    expect(fronts.has(card.front)).toBe(false);
    fronts.add(card.front);
    // "Niente domande sì/no" (docs/03 §3.1) — a loose heuristic check.
    expect(card.front.toLowerCase()).not.toMatch(/^(è vero che|vero o falso)/);
  }
}

describe('generate_flashcards golden set', () => {
  const provider = new FakeProvider();

  for (const fixture of FIXTURES) {
    it(`clears the quality bar for ${fixture}`, async () => {
      const text = readFileSync(resolve(__dirname, 'fixtures', fixture), 'utf-8');
      const { data } = await provider.generateFlashcards(
        {
          subjectName: fixture,
          chunks: [{ docId: randomUUID(), page: 1, text }],
          count: 'auto',
          types: ['basic', 'cloze'],
          difficulty: 2,
          lang: 'it',
        },
        'irrelevant',
      );
      assertQualityBar(data, text);
    });
  }
});
