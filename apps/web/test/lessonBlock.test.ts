import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CheckLessonBlockResponse, LessonBlockDto } from '@studyhub/contracts';
import { LessonBlock } from '@/components/lesson/LessonBlock';
import { LessonOutline } from '@/components/lesson/LessonOutline';
import {
  formulaSource,
  initialBlockIndex,
  interruptionText,
  isBudgetMessage,
  shouldPollLesson,
  toDisplayMath,
  upsertBlock,
} from '@/lib/lessonClient';

const UUID = '11111111-1111-4111-8111-111111111111';

function makeBlock(over: Partial<LessonBlockDto> = {}): LessonBlockDto {
  return {
    id: UUID,
    orderIndex: 0,
    title: 'Il primo principio',
    body: 'Parti dall’intuizione: l’energia si conserva.',
    formula: String.raw`\Delta U = Q - W`,
    exampleSteps: [
      { text: 'Passo uno' },
      { text: 'Passo due', formula: 'x=2' },
      { text: 'Passo tre' },
    ],
    trap: 'Confondere il segno di W.',
    checkQuestion: 'Cosa si conserva?',
    checkAnswer: null,
    citations: [{ docId: UUID, documentName: 'Termodinamica.pdf', page: 4, quote: 'ΔU = Q - W' }],
    state: 'open',
    studentAnswer: null,
    ...over,
  };
}

const noop = () => {};
function render(props: Partial<Parameters<typeof LessonBlock>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(LessonBlock, {
      block: makeBlock(),
      total: 3,
      readOnly: false,
      checkResult: null,
      checking: false,
      checkError: null,
      regenerating: false,
      isLast: false,
      onOpenCitation: noop,
      onInterrupt: noop,
      onCheck: noop,
      onNext: noop,
      onRegenerate: noop,
      ...props,
    }),
  );
}

describe('LessonBlock', () => {
  it('open block: title, only the first example step, trap, formula source, disabled check', () => {
    const html = render();
    expect(html).toContain('Blocco 1 di 3');
    expect(html).toContain('Il primo principio');
    expect(html).toContain('Passo uno');
    expect(html).not.toContain('Passo due');
    expect(html).toContain('Passaggio successivo');
    expect(html).toContain('Errore tipico all&#x27;esame');
    expect(html).toContain('Termodinamica.pdf · p. 4 →');
    expect(html).toContain('Prima di andare avanti');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Controlla<\/button>/);
    expect(html).not.toContain('Blocco successivo');
    for (const label of ['Non ho capito questo passaggio', 'Fammi un altro esempio', 'Perché?']) {
      expect(html).toContain(label);
    }
  });

  it('omits formula, example and trap when the block has none', () => {
    const html = render({
      block: makeBlock({ formula: null, exampleSteps: [], trap: null, citations: [] }),
    });
    expect(html).not.toContain('Esempio svolto');
    expect(html).not.toContain('Errore tipico');
    expect(html).not.toContain('<figure');
  });

  it.each([
    ['ok', 'Ci sei.'],
    ['partial', 'Quasi.'],
    ['wrong', 'Da rivedere.'],
  ] as const)('verdict %s shows its text, the expected answer and the next button', (v, text) => {
    const done = makeBlock({ state: 'done', checkAnswer: 'L’energia.', studentAnswer: 'boh' });
    const checkResult: CheckLessonBlockResponse = {
      block: done,
      verdict: v,
      feedback: 'Un commento.',
      nextBlock: null,
    };
    const html = render({ block: done, checkResult });
    expect(html).toContain(text);
    expect(html).toContain('Un commento.');
    expect(html).toContain('L’energia.');
    expect(html).toContain('Blocco successivo →');
    expect(html).not.toMatch(/>Controlla</);
  });

  it('done block is read-only: all example steps, no "Controlla"', () => {
    const html = render({
      block: makeBlock({ state: 'done', checkAnswer: 'x', studentAnswer: 'risposta data' }),
    });
    expect(html).toContain('Passo tre');
    expect(html).toContain('risposta data');
    expect(html).not.toMatch(/>Controlla</);
  });

  it('finished session hides interruptions and regeneration', () => {
    const html = render({ readOnly: true });
    expect(html).not.toContain('Interrompi il tutor');
    expect(html).not.toContain('Rispiegamelo');
  });

  it('last block has no next button; regenerating shows the status', () => {
    const done = makeBlock({ state: 'done', checkAnswer: 'x' });
    expect(render({ block: done, isLast: true })).not.toContain('Blocco successivo');
    expect(render({ regenerating: true })).toContain('Sto riscrivendo questo blocco…');
  });
});

describe('LessonOutline', () => {
  it('marks the current block, and locks those not available yet', () => {
    const html = renderToStaticMarkup(
      createElement(LessonOutline, {
        blocks: [
          makeBlock(),
          makeBlock({
            id: UUID.replace('1', '2'),
            orderIndex: 1,
            state: 'locked',
            title: 'Secondo',
          }),
        ],
        blockCount: 3,
        currentIndex: 0,
        onSelect: noop,
      }),
    );
    expect(html).toContain('La lezione · 3 blocchi');
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html.match(/aria-disabled="true"/g)).toHaveLength(2);
    expect(html).toContain('Si sblocca dopo il blocco 1');
    expect(html).toContain('Blocco 3');
  });
});

describe('lessonClient helpers', () => {
  it('builds the tutor question citing the block', () => {
    const b = { orderIndex: 1, title: 'Entropia' };
    expect(interruptionText('not_understood', b)).toBe(
      'Nel blocco 2 («Entropia») non ho capito questo passaggio: ',
    );
    expect(interruptionText('why', b)).toContain('perché');
  });

  it('picks the block to open', () => {
    const done = makeBlock({ state: 'done' });
    const open = makeBlock({ orderIndex: 1, state: 'open' });
    expect(initialBlockIndex([done, open], 0)).toBe(0);
    expect(initialBlockIndex([done, open], 5)).toBe(1);
    expect(initialBlockIndex([], 0)).toBe(0);
  });

  it('formula helpers', () => {
    expect(toDisplayMath('$$a+b$$')).toBe('$$\na+b\n$$');
    const b = makeBlock({
      citations: [
        { docId: UUID, documentName: 'A', page: 1, quote: 'altro' },
        { docId: UUID, documentName: 'B', page: 2, quote: 'vale ΔU = Q - W qui' },
      ],
    });
    expect(formulaSource({ ...b, formula: 'ΔU=Q-W' })?.page).toBe(2);
    expect(formulaSource({ ...b, formula: null })?.page).toBe(1);
  });

  it('upsertBlock keeps order; budget message detection', () => {
    const a = makeBlock();
    const c = makeBlock({ orderIndex: 2 });
    expect(upsertBlock([c], a).map((x) => x.orderIndex)).toEqual([0, 2]);
    expect(isBudgetMessage('Budget giornaliero raggiunto. Riprova domani.')).toBe(true);
    expect(isBudgetMessage('timeout')).toBe(false);
  });
});

describe('shouldPollLesson', () => {
  const job = (status: 'queued' | 'running' | 'succeeded' | 'failed') => ({
    id: UUID,
    blockIndex: 1,
    status,
    error: null,
  });
  const d0 = makeBlock({ state: 'done' });
  const o1 = makeBlock({ orderIndex: 1, state: 'open' });
  it('polls while a job runs, only if the session is active', () => {
    const data = { blocks: [d0], blockCount: 3, job: job('running') };
    expect(shouldPollLesson(data, true)).toBe(true);
    expect(shouldPollLesson(data, false)).toBe(false);
  });
  it('stops when blocks are one ahead of the student', () => {
    expect(shouldPollLesson({ blocks: [o1], blockCount: 3, job: job('succeeded') }, true)).toBe(
      false,
    );
  });
  it('polls when the block after the last done one is missing, unless the job failed', () => {
    expect(shouldPollLesson({ blocks: [d0], blockCount: 3, job: job('succeeded') }, true)).toBe(
      true,
    );
    expect(shouldPollLesson({ blocks: [d0], blockCount: 3, job: job('failed') }, true)).toBe(false);
    expect(shouldPollLesson({ blocks: [d0], blockCount: 1, job: null }, true)).toBe(false);
    expect(shouldPollLesson(undefined, true)).toBe(false);
  });
});
