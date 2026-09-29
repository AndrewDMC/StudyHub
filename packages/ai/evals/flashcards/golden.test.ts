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
 * 9 fixtures across 9 distinct subject domains (docs/03 §6 asks for "5-10
 * documenti reali") — still declared as **synthetic**, not real uploaded
 * documents: this session has no real study material to source from, so
 * each fixture is a short, fact-dense paragraph written to look like real
 * study notes (dates, names, formulas, verifiable claims) rather than a
 * genuine excerpt. Domain spread matters more than fixture count here — a
 * prompt regression that only shows up on, say, a numeric/formula-heavy
 * fixture (algoritmi-complessita, analisi-derivate, chimica-legami) would
 * hide behind 2 humanities-leaning fixtures alone.
 */
const FIXTURES = [
  'termodinamica.txt',
  'diritto-costituzionale.txt',
  'biologia-cellulare.txt',
  'algoritmi-complessita.txt',
  'rivoluzione-francese.txt',
  'microeconomia-domanda-offerta.txt',
  'chimica-legami.txt',
  'analisi-derivate.txt',
  'psicologia-memoria.txt',
];

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
