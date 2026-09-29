import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import type { FlashcardSchedule } from '@studyhub/core';
import {
  ApkgError,
  buildApkg,
  clozeToAnki,
  fromAnkiHtml,
  isolateCloze,
  importedSchedule,
  parseApkg,
  toAnkiHtml,
  type AnkiExportCard,
} from '../src/lib/anki';

const NOW = new Date('2026-09-28T10:00:00.000Z');

function card(over: Partial<AnkiExportCard> & { schedule: FlashcardSchedule }): AnkiExportCard {
  return {
    id: crypto.randomUUID(),
    type: 'basic',
    front: 'Fronte',
    back: 'Retro',
    hint: null,
    tags: [],
    suspended: false,
    createdAt: new Date('2026-09-01T08:00:00.000Z'),
    ...over,
  };
}

const NEW: FlashcardSchedule = {
  stability: null,
  difficulty: null,
  dueAt: null,
  lastReviewAt: null,
  reps: 0,
  lapses: 0,
  state: 'new',
};

describe('text conversion', () => {
  it('math and newlines survive a round trip through Anki HTML', () => {
    const text = 'Energia: $E=mc^2$ e\n$$\\int_0^1 a < b\\,dx$$ fine';
    const html = toAnkiHtml(text);
    expect(html).toContain('\\(E=mc^2\\)');
    expect(html).toContain('\\[\\int_0^1 a &lt; b\\,dx\\]');
    expect(html).toContain('<br>');
    expect(fromAnkiHtml(html)).toBe(text);
  });

  it('escapes markup on export and strips it on import', () => {
    expect(toAnkiHtml('a < b & <b>c</b>')).toBe('a &lt; b &amp; &lt;b&gt;c&lt;/b&gt;');
    expect(fromAnkiHtml('<div>Ciao&nbsp;<b>mondo</b></div><div>riga 2</div>')).toBe(
      'Ciao mondo\nriga 2',
    );
  });

  it('turns images into a visible placeholder instead of dropping them silently', () => {
    expect(fromAnkiHtml('Guarda <img src="grafico.png"> qui')).toBe(
      'Guarda [immagine: grafico.png] qui',
    );
  });
});

describe('clozeToAnki', () => {
  it('recovers the answer from the generator’s {{...}} + full-sentence shape', () => {
    expect(clozeToAnki('La {{...}} è un fatto', 'La mitocondria è un fatto')).toEqual({
      text: 'La {{c1::mitocondria}} è un fatto',
      extra: '',
    });
  });

  it('keeps Anki-style cloze as it is', () => {
    expect(clozeToAnki('A {{c1::x}}', 'extra')).toEqual({ text: 'A {{c1::x}}', extra: 'extra' });
  });

  it('gives up (null) when front and back do not line up', () => {
    expect(clozeToAnki('La {{...}} è', 'Tutta un’altra frase')).toBeNull();
    expect(clozeToAnki('senza blank', 'senza blank')).toBeNull();
  });
});

describe('apkg round trip', () => {
  const reviewed: FlashcardSchedule = {
    stability: 12.3456789,
    difficulty: 6.789,
    dueAt: new Date('2026-10-10T07:30:00.000Z'),
    lastReviewAt: new Date('2026-09-25T07:30:00.000Z'),
    reps: 5,
    lapses: 1,
    state: 'review',
  };
  const learning: FlashcardSchedule = {
    stability: 0.4,
    difficulty: 5.1,
    dueAt: new Date('2026-09-28T10:10:00.000Z'),
    lastReviewAt: new Date('2026-09-28T10:00:00.000Z'),
    reps: 1,
    lapses: 0,
    state: 'learning',
  };
  const relearning: FlashcardSchedule = {
    stability: 2.2,
    difficulty: 8.1,
    dueAt: new Date('2026-09-29T00:00:00.000Z'),
    lastReviewAt: new Date('2026-09-27T00:00:00.000Z'),
    reps: 9,
    lapses: 3,
    state: 'relearning',
  };

  it('preserves every card’s scheduling state exactly (F4 acceptance criterion)', async () => {
    const cards = [
      card({ front: 'nuova', schedule: NEW }),
      card({ front: 'rev', schedule: reviewed, tags: ['esame', 'cap 3'] }),
      card({ front: 'learn', schedule: learning }),
      card({ front: 'relearn', schedule: relearning }),
      card({ front: 'sospesa', schedule: reviewed, suspended: true }),
    ];
    const bytes = await buildApkg(cards, { deckName: 'Fisica', now: NOW });
    const parsed = await parseApkg(bytes);

    expect(parsed.deckName).toBe('Fisica');
    expect(parsed.warnings).toEqual([]);
    expect(parsed.cards).toHaveLength(5);
    for (const [i, original] of cards.entries()) {
      const back = parsed.cards[i]!;
      expect(back.front).toBe(original.front);
      expect(back.schedule).toEqual(original.schedule);
      expect(back.suspended).toBe(original.suspended);
    }
    expect(parsed.cards[1]!.tags).toEqual(['esame', 'cap_3']);
  });

  it('round-trips text, hint, math and a generated cloze card', async () => {
    const cards = [
      card({
        front: 'Formula di $E$?',
        back: '$$E=mc^2$$\ncon c costante',
        hint: 'Einstein',
        schedule: NEW,
      }),
      card({
        type: 'cloze',
        front: 'La {{...}} produce energia',
        back: 'La mitocondria produce energia',
        schedule: NEW,
      }),
    ];
    const parsed = await parseApkg(await buildApkg(cards, { deckName: 'Bio', now: NOW }));

    expect(parsed.cards[0]).toMatchObject({
      type: 'basic',
      front: 'Formula di $E$?',
      back: '$$E=mc^2$$\ncon c costante',
      hint: 'Einstein',
    });
    expect(parsed.cards[1]).toMatchObject({
      type: 'cloze',
      front: 'La {{c1::mitocondria}} produce energia',
      back: 'La mitocondria produce energia',
    });
  });

  it('a cloze with several deletions stays one card with every blank hidden together', async () => {
    const parsed = await parseApkg(
      await buildApkg(
        [card({ type: 'cloze', front: '{{c1::a}} e {{c2::b}}', back: 'nota', schedule: NEW })],
        { deckName: 'X', now: NOW },
      ),
    );
    expect(parsed.cards).toHaveLength(1);
    expect(parsed.cards[0]!.front).toBe('{{c1::a}} e {{c1::b}}');
    expect(parsed.cards[0]!.back).toBe('nota');
  });

  it('an imported multi-number Anki note asks one number per card', () => {
    // isolateCloze is what parseApkg applies per Anki card (ord k → number k+1).
    expect(isolateCloze('{{c1::a}} e {{c2::b}}', 2)).toBe('a e {{c2::b}}');
  });

  it('hands out unique ids to cards created in the same millisecond', async () => {
    const same = new Date('2026-09-01T08:00:00.000Z');
    const cards = [1, 2, 3].map((n) => card({ front: `c${n}`, createdAt: same, schedule: NEW }));
    const parsed = await parseApkg(await buildApkg(cards, { deckName: 'X', now: NOW }));
    expect(parsed.cards.map((c) => c.front)).toEqual(['c1', 'c2', 'c3']);
  });

  it('exports an empty deck without error', async () => {
    const parsed = await parseApkg(await buildApkg([], { deckName: 'Vuoto', now: NOW }));
    expect(parsed.cards).toEqual([]);
  });
});

describe('importedSchedule (files that did not come from StudyHub)', () => {
  const base = {
    type: 2,
    queue: 2,
    due: 0,
    ivl: 30,
    factor: 2500,
    reps: 8,
    lapses: 1,
    left: 0,
    data: '',
  };
  const crt = Math.floor(NOW.getTime() / 86_400_000) * 86400;

  it('new card → new schedule', () => {
    expect(importedSchedule({ ...base, type: 0, queue: 0 }, crt).state).toBe('new');
  });

  it('review card without FSRS data: stability ≈ interval, due from the day counter', () => {
    const s = importedSchedule({ ...base, due: 10 }, crt);
    expect(s.state).toBe('review');
    expect(s.stability).toBe(30);
    expect(s.dueAt!.toISOString()).toBe('2026-10-08T00:00:00.000Z');
    expect(s.lastReviewAt!.toISOString()).toBe('2026-09-08T00:00:00.000Z');
    expect(s.difficulty).toBeGreaterThan(1);
    expect(s.difficulty).toBeLessThan(10);
  });

  it('a harder (lower-ease) card gets a higher difficulty', () => {
    const easy = importedSchedule({ ...base, factor: 3000 }, crt).difficulty!;
    const hard = importedSchedule({ ...base, factor: 1400 }, crt).difficulty!;
    expect(hard).toBeGreaterThan(easy);
  });

  it('uses Anki’s own FSRS memory state when present', () => {
    const s = importedSchedule({ ...base, data: '{"s":42.5,"d":7.25}' }, crt);
    expect(s.stability).toBe(42.5);
    expect(s.difficulty).toBe(7.25);
  });

  it('ignores garbage in `data` instead of throwing', () => {
    expect(() => importedSchedule({ ...base, data: '{not json' }, crt)).not.toThrow();
  });

  it('a learning card gets a finite stability so FSRS can schedule it', () => {
    const s = importedSchedule({ ...base, type: 1, queue: 1, due: 1_790_000_000, ivl: 0 }, crt);
    expect(s.state).toBe('learning');
    expect(Number.isFinite(s.stability)).toBe(true);
  });
});

describe('parseApkg errors', () => {
  it('rejects something that is not a zip', async () => {
    await expect(parseApkg(new TextEncoder().encode('non è un file zip'))).rejects.toBeInstanceOf(
      ApkgError,
    );
  });

  it('explains how to re-export when only the new compressed format is present', async () => {
    const zip = zipSync({
      'collection.anki21b': new Uint8Array([1, 2, 3]),
      media: new Uint8Array(),
    });
    await expect(parseApkg(zip)).rejects.toThrow(/versioni precedenti/);
  });

  it('rejects a zip with no collection', async () => {
    const zip = zipSync({ 'readme.txt': new TextEncoder().encode('ciao') });
    await expect(parseApkg(zip)).rejects.toThrow(/Nessuna collezione/);
  });

  it('rejects a corrupt collection', async () => {
    const zip = zipSync({ 'collection.anki2': new TextEncoder().encode('this is not sqlite') });
    await expect(parseApkg(zip)).rejects.toBeInstanceOf(ApkgError);
  });
});
