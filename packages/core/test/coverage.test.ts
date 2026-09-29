import { describe, expect, it } from 'vitest';
import {
  computeCoverageMap,
  describeGap,
  mentionsTopic,
  normalizeText,
  type CoverageTopicInput,
} from '../src/coverage.js';

const topic = (over: Partial<CoverageTopicInput> & { name: string }): CoverageTopicInput => ({
  id: over.name,
  mastery: null,
  materialDocs: 1,
  materialPages: 10,
  cards: 5,
  ...over,
});

describe('mentionsTopic', () => {
  it('ignores case, accents and punctuation', () => {
    expect(mentionsTopic('Esercizio 2: Entropìa, del sistema.', 'entropia')).toBe(true);
  });

  it('matches plurals/genders by stem (trasformata / trasformate)', () => {
    expect(mentionsTopic('Calcolare le trasformate di Laplace', 'Trasformata di Laplace')).toBe(
      true,
    );
  });

  it('needs every identifying word, not just one', () => {
    expect(mentionsTopic('Serie di Fourier', 'Trasformata di Laplace')).toBe(false);
    expect(mentionsTopic('la trasformata di Fourier', 'Trasformata di Laplace')).toBe(false);
  });

  it('does not match inside another word', () => {
    expect(mentionsTopic('termodinamica', 'dina')).toBe(false); // stem "dina" must start a word
  });

  it('falls back to the whole name for a name with only short words', () => {
    expect(mentionsTopic('Intelligenza e AI oggi', 'AI')).toBe(true);
    expect(mentionsTopic('Il RAIL è un tipo', 'AI')).toBe(false);
  });
});

describe('normalizeText', () => {
  it('is idempotent', () => {
    const once = normalizeText('  Città, ÈCCO!  ');
    expect(normalizeText(once)).toBe(once);
    expect(once).toBe('citta ecco');
  });
});

describe('computeCoverageMap', () => {
  const laplace = 'Trasformata di Laplace';
  const exams = [
    'Es 1: trasformata di Laplace del segnale. Es 2: entropia.',
    'Calcolare la trasformata di Laplace. Es 2: cicli di Carnot.',
    'Es 1: trasformate di Laplace. Es 2: entropia.',
    'Es 1: trasformata di Laplace inversa.',
    'Solo entropia oggi.',
  ];

  it('counts how many exams mention a topic, out of all of them ("4 esami su 5")', () => {
    const map = computeCoverageMap({
      topics: [topic({ name: laplace, materialDocs: 0, materialPages: 0 })],
      examTexts: exams,
      materialTexts: [],
      recurringTopics: [],
    });
    expect(map.examTotal).toBe(5);
    expect(map.topics[0]).toMatchObject({ examMentions: 4, examTotal: 5 });
    expect(map.topics[0]!.flags).toContain('no_material');
    expect(describeGap(map.topics[0]!)).toBe(
      'Non hai materiale su "Trasformata di Laplace" e nessuna flashcard'.replace(
        ' e nessuna flashcard',
        '',
      ) + ', che compare in 4 esami su 5.',
    );
  });

  it('flags no_material, no_cards and weak independently', () => {
    const map = computeCoverageMap({
      topics: [
        topic({ name: 'Entropia', materialDocs: 0, cards: 0, mastery: 0.2 }),
        topic({ name: 'Carnot', cards: 0 }),
        topic({ name: 'Calore', mastery: 0.3 }),
        topic({ name: 'Lavoro', mastery: 0.9 }),
      ],
      examTexts: [],
      materialTexts: [],
      recurringTopics: [],
    });
    const flags = (n: string) => map.topics.find((t) => t.name === n)!.flags;
    expect(flags('Entropia')).toEqual(['no_material', 'no_cards', 'weak']);
    expect(flags('Carnot')).toEqual(['no_cards']);
    expect(flags('Calore')).toEqual(['weak']);
    expect(flags('Lavoro')).toEqual([]);
  });

  it('a topic with no gap has priority 0 and no sentence, however often exams ask it', () => {
    const map = computeCoverageMap({
      topics: [topic({ name: 'Entropia', mastery: 0.9 })],
      examTexts: ['entropia', 'entropia'],
      materialTexts: [],
      recurringTopics: [],
    });
    expect(map.topics[0]!.priority).toBe(0);
    expect(describeGap(map.topics[0]!)).toBeNull();
  });

  it('ranks by exam frequency × severity: a missing frequent topic beats a missing rare one', () => {
    const map = computeCoverageMap({
      topics: [
        topic({ name: 'Rara', materialDocs: 0 }),
        topic({ name: 'Frequente', materialDocs: 0 }),
        topic({ name: 'Solocarte', cards: 0 }),
      ],
      examTexts: ['frequente', 'frequente', 'frequente', 'rara'],
      materialTexts: [],
      recurringTopics: [],
    });
    expect(map.topics.map((t) => t.name)).toEqual(['Frequente', 'Rara', 'Solocarte']);
  });

  it("uses the profile's recurring topics as evidence when no exam text names the topic", () => {
    const map = computeCoverageMap({
      topics: [topic({ name: 'Entropia', materialDocs: 0 })],
      examTexts: ['testo senza il termine'],
      materialTexts: [],
      recurringTopics: ['entropia'],
    });
    expect(map.topics[0]!.recurring).toBe(true);
    expect(describeGap(map.topics[0]!)).toContain('ricorrente');
  });

  it('surfaces recurring exam themes that match no topic, worst-covered first', () => {
    const map = computeCoverageMap({
      topics: [topic({ name: 'Entropia' })],
      examTexts: [],
      materialTexts: ['la serie di Fourier converge', 'esempi: serie di Fourier'],
      recurringTopics: ['Entropia', 'Trasformata di Laplace', 'Serie di Fourier', 'entropia', ' '],
    });
    expect(map.unmapped).toEqual([
      { name: 'Trasformata di Laplace', materialMentions: 0 },
      { name: 'Serie di Fourier', materialMentions: 2 },
    ]);
  });

  it('is empty-safe: no topics, no exams', () => {
    expect(
      computeCoverageMap({ topics: [], examTexts: [], materialTexts: [], recurringTopics: [] }),
    ).toEqual({ examTotal: 0, topics: [], unmapped: [] });
  });
});
