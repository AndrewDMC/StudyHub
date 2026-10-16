import { describe, expect, it } from 'vitest';
import { buildTopicNameIndex, matchTopicId, normalizeTopicName } from '../src/topicMatch.js';

describe('normalizeTopicName', () => {
  it('folds case, accents and whitespace', () => {
    expect(normalizeTopicName('  Secondo   Principio\tdella TERMODINAMICA ')).toBe(
      'secondo principio della termodinamica',
    );
    expect(normalizeTopicName('Perché è così: Cinematica')).toBe('perche e cosi: cinematica');
  });

  it('composes the same key for precomposed and decomposed accents', () => {
    expect(normalizeTopicName('Entropiá')).toBe(normalizeTopicName('Entropiá'));
  });
});

describe('matchTopicId', () => {
  const topics = [
    { id: 't1', name: 'Termodinamica' },
    { id: 't2', name: 'Elettromagnetismo' },
    { id: 't3', name: 'Perché' },
  ];
  const index = buildTopicNameIndex(topics);

  it('matches ignoring case, accents and surrounding/extra spaces', () => {
    expect(matchTopicId('termodinamica', index)).toBe('t1');
    expect(matchTopicId('  ELETTROMAGNETISMO ', index)).toBe('t2');
    expect(matchTopicId('perche', index)).toBe('t3');
  });

  it('returns null for an unknown, empty, blank or missing name (a miss, never a guess)', () => {
    expect(matchTopicId('Ottica', index)).toBeNull();
    expect(matchTopicId('', index)).toBeNull();
    expect(matchTopicId('   ', index)).toBeNull();
    expect(matchTopicId(null, index)).toBeNull();
    expect(matchTopicId(undefined, index)).toBeNull();
  });

  it('does not do partial matching', () => {
    expect(matchTopicId('Termodinamica avanzata', index)).toBeNull();
    expect(matchTopicId('Termo', index)).toBeNull();
  });

  it('first topic wins when two normalize to the same key', () => {
    const dup = buildTopicNameIndex([
      { id: 'a', name: 'Analisi' },
      { id: 'b', name: 'analisi ' },
    ]);
    expect(matchTopicId('ANALISI', dup)).toBe('a');
  });
});
