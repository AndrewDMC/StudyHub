import { describe, expect, it } from 'vitest';
import {
  parseAnswerCitations,
  renderSessionTranscript,
  transcriptFileName,
  windowMessages,
} from '../src/sessionChat.js';

const turn = (role: 'user' | 'assistant', content: string) => ({ role, content });

describe('windowMessages', () => {
  it('keeps the most recent turns, oldest first', () => {
    const all = Array.from({ length: 15 }, (_, i) => turn(i % 2 ? 'assistant' : 'user', `m${i}`));
    const w = windowMessages(all, { maxMessages: 4 });
    expect(w.map((m) => m.content)).toEqual(['m11', 'm12', 'm13', 'm14']);
  });

  it('stops at the character budget but always keeps the newest turn', () => {
    const all = [
      turn('user', 'a'.repeat(50)),
      turn('assistant', 'b'.repeat(50)),
      turn('user', 'c'.repeat(500)),
    ];
    expect(windowMessages(all, { maxChars: 100 }).map((m) => m.content[0])).toEqual(['c']);
    expect(windowMessages(all, { maxChars: 700 })).toHaveLength(3);
  });

  it('handles an empty history', () => {
    expect(windowMessages([])).toEqual([]);
  });
});

describe('parseAnswerCitations', () => {
  const sources = [
    { ref: 1, name: 'A' },
    { ref: 2, name: 'B' },
    { ref: 3, name: 'C' },
  ];

  it('collects valid citations in order of first appearance, once each', () => {
    const r = parseAnswerCitations('Fubini vale [2]. Il dominio è normale [1] [2].', sources);
    expect(r.cited.map((s) => s.name)).toEqual(['B', 'A']);
    expect(r.text).toBe('Fubini vale [2]. Il dominio è normale [1] [2].');
  });

  it('drops markers to sources that were never provided', () => {
    const r = parseAnswerCitations('Lo dice il libro [7].', sources);
    expect(r.cited).toEqual([]);
    expect(r.text).toBe('Lo dice il libro.');
  });

  it('normalises grouped markers and filters the invalid ones inside', () => {
    const r = parseAnswerCitations('Vero [1, 9, 3].', sources);
    expect(r.text).toBe('Vero [1][3].');
    expect(r.cited.map((s) => s.ref)).toEqual([1, 3]);
  });

  it('leaves text without markers alone', () => {
    const r = parseAnswerCitations('Questo non è nel materiale.', sources);
    expect(r).toEqual({ text: 'Questo non è nel materiale.', cited: [] });
  });
});

describe('transcript', () => {
  it('names the file by date, title and session id', () => {
    const name = transcriptFileName(
      'Integrali doppi + Fubini',
      new Date(2026, 8, 29, 10, 0),
      'abcdef12-0000-0000-0000-000000000000',
    );
    expect(name).toBe('2026-09-29-integrali-doppi-fubini-abcdef12.md');
    expect(transcriptFileName('???', new Date(2026, 0, 2), '12345678-x')).toBe(
      '2026-01-02-sessione-12345678.md',
    );
  });

  it('renders front matter, turns, the selected passage and wikilinked sources', () => {
    const md = renderSessionTranscript({
      title: 'Integrali doppi',
      subjectName: 'Analisi 2',
      topicNames: ['Integrali doppi'],
      startedAt: new Date(2026, 8, 29, 10, 0),
      endedAt: new Date(2026, 8, 29, 10, 50),
      activeMs: 50 * 60_000,
      pomodoros: 2,
      messages: [
        {
          role: 'user',
          content: 'Perché vale Fubini?',
          focus: { documentName: 'Appunti.pdf', page: 5, text: 'Teorema di Fubini' },
          citations: [],
          createdAt: new Date(2026, 8, 29, 10, 5),
        },
        {
          role: 'assistant',
          content: 'Perché il dominio è normale [1].',
          citations: [{ ref: 1, documentName: 'Appunti.pdf', page: 5 }],
          createdAt: new Date(2026, 8, 29, 10, 6),
        },
        {
          role: 'assistant',
          content: 'Non lo so.',
          citations: [],
          createdAt: new Date(2026, 8, 29, 10, 7),
        },
      ],
    });
    expect(md).toContain('studio_minuti: 50');
    expect(md).toContain('materia: "Analisi 2"');
    expect(md).toContain('> Teorema di Fubini\n> — Appunti.pdf, p. 5');
    expect(md).toContain('Fonti: [1] [[Appunti.pdf#p. 5|Appunti.pdf · p. 5]]');
    expect(md).toContain('_Risposta non ancorata al materiale._');
    expect(md.startsWith('---\n')).toBe(true);
  });

  it('says so when nothing was asked', () => {
    const md = renderSessionTranscript({
      title: 'Studio libero',
      subjectName: 'Fisica',
      topicNames: [],
      startedAt: new Date(2026, 0, 1),
      endedAt: new Date(2026, 0, 1),
      activeMs: 0,
      pomodoros: 0,
      messages: [],
    });
    expect(md).toContain('Nessuna domanda');
  });
});
