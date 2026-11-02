import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PhaseStepperCompact } from '@/components/lesson/PhaseStepperCompact';
import { LessonActionBar } from '@/components/lesson/LessonActionBar';
import {
  LESSON_PHASES,
  NEXT_ACTION,
  SPRINT_LESSON_PHASES,
  SPRINT_NEXT_ACTION,
  barBackFor,
  barHasSlot,
  barPrimaryFor,
  phaseStatusLabel,
} from '@/lib/lessonClient';

describe('phaseStatusLabel', () => {
  it('says the status in words', () => {
    expect(phaseStatusLabel('done')).toBe('fatta');
    expect(phaseStatusLabel('current')).toBe('fase corrente');
    expect(phaseStatusLabel('todo')).toBe('da fare');
  });
});

describe('barPrimaryFor: standard lesson', () => {
  const base = { flow: 'standard', active: true } as const;

  it('uses the labels of the buttons in the page', () => {
    expect(barPrimaryFor({ ...base, phase: 'explore' })).toEqual({
      kind: 'phase',
      label: NEXT_ACTION.explore!.label,
      to: 'understand',
      quiet: false,
    });
    expect(barPrimaryFor({ ...base, phase: 'rework' })).toMatchObject({
      label: 'Passa agli esercizi →',
      to: 'apply',
    });
    expect(barPrimaryFor({ ...base, phase: 'apply' })).toMatchObject({
      label: 'Ho finito · chiudi la lezione →',
      to: 'recall',
    });
  });

  it('leaves the slot to the block while studying', () => {
    expect(barPrimaryFor({ ...base, phase: 'understand' })).toEqual({ kind: 'block' });
  });

  it('has no primary in Ricorda: the lesson is closed by the button in the page', () => {
    expect(barPrimaryFor({ ...base, phase: 'recall' })).toEqual({ kind: 'none' });
  });

  it('a finished lesson only offers the way to Ricorda', () => {
    expect(barPrimaryFor({ flow: 'standard', phase: 'understand', active: false })).toEqual({
      kind: 'phase',
      label: 'Vai a Ricorda',
      to: 'recall',
      quiet: false,
    });
    expect(barPrimaryFor({ flow: 'standard', phase: 'recall', active: false })).toEqual({
      kind: 'none',
    });
  });
});

describe('barPrimaryFor: sprint lesson', () => {
  const base = { flow: 'sprint', active: true } as const;

  it('exercises: quiet until every exercise is rated', () => {
    const next = SPRINT_NEXT_ACTION.exercises!;
    expect(barPrimaryFor({ ...base, phase: 'exercises' })).toEqual({
      kind: 'phase',
      label: next.label,
      to: 'theory',
      quiet: true,
    });
    expect(barPrimaryFor({ ...base, phase: 'exercises', sprintDone: true })).toMatchObject({
      quiet: false,
    });
  });

  it('theory belongs to the block, retry goes to Ricorda, Ricorda has none', () => {
    expect(barPrimaryFor({ ...base, phase: 'theory' })).toEqual({ kind: 'block' });
    expect(barPrimaryFor({ ...base, phase: 'retry' })).toMatchObject({
      to: 'recall',
      quiet: false,
    });
    expect(barPrimaryFor({ ...base, phase: 'recall' })).toEqual({ kind: 'none' });
  });
});

describe('barPrimaryFor: older sprint lesson (no phases)', () => {
  it('only has the blocks while active, nothing when over', () => {
    expect(barPrimaryFor({ flow: 'legacy', phase: 'understand', active: true })).toEqual({
      kind: 'block',
    });
    expect(barPrimaryFor({ flow: 'legacy', phase: 'understand', active: false })).toEqual({
      kind: 'none',
    });
  });
});

describe('barBackFor', () => {
  it('goes to the previous block while studying, then to the previous phase', () => {
    expect(barBackFor({ flow: 'standard', phase: 'understand', current: 2 })).toEqual({
      kind: 'block',
      label: 'Blocco precedente',
    });
    expect(barBackFor({ flow: 'standard', phase: 'understand', current: 0 })).toEqual({
      kind: 'phase',
      label: 'Fase precedente: Esplora',
      to: 'explore',
    });
    expect(barBackFor({ flow: 'sprint', phase: 'theory', current: 1 })).toMatchObject({
      kind: 'block',
    });
    expect(barBackFor({ flow: 'sprint', phase: 'theory', current: 0 })).toMatchObject({
      to: 'exercises',
    });
  });

  it('has no back on the first phase and none for an older sprint lesson', () => {
    expect(barBackFor({ flow: 'standard', phase: 'explore', current: 0 })).toBeNull();
    expect(barBackFor({ flow: 'sprint', phase: 'exercises', current: 0 })).toBeNull();
    expect(barBackFor({ flow: 'legacy', phase: 'understand', current: 3 })).toBeNull();
  });

  it('does not take the block back outside the studying phase', () => {
    expect(barBackFor({ flow: 'standard', phase: 'rework', current: 4 })).toMatchObject({
      kind: 'phase',
      to: 'understand',
    });
  });
});

describe('PhaseStepperCompact', () => {
  it('names every phase with its number and status, five columns for the standard lesson', () => {
    const html = renderToStaticMarkup(
      createElement(PhaseStepperCompact, {
        current: 'understand',
        phases: LESSON_PHASES,
        statusOf: (id: string) =>
          id === 'explore' ? 'done' : id === 'understand' ? 'current' : 'todo',
        onSelect: () => {},
      }),
    );
    expect(html).toContain('aria-label="Fasi della lezione"');
    expect(html).toContain('grid-cols-5');
    expect(html).toContain('aria-label="Fase 1 di 5: Esplora, fatta"');
    expect(html).toContain('aria-label="Fase 2 di 5: Studia, fase corrente"');
    expect(html).toContain('aria-current="step"');
    expect(html).toContain('aria-label="Fase 5 di 5: Ricorda, da fare"');
  });

  it('uses four columns and its own label for a sprint lesson', () => {
    const html = renderToStaticMarkup(
      createElement(PhaseStepperCompact, {
        current: 'exercises',
        phases: SPRINT_LESSON_PHASES,
        statusOf: (id: string) => (id === 'exercises' ? 'current' : 'todo'),
        ariaLabel: 'Fasi della lezione sprint',
        onSelect: () => {},
      }),
    );
    expect(html).toContain('aria-label="Fasi della lezione sprint"');
    expect(html).toContain('grid-cols-4');
    expect(html).toContain('Fase 4 di 4: Ricorda');
  });
});

describe('LessonActionBar', () => {
  const props = {
    onBack: () => {},
    onPhase: () => {},
    onOpenSide: () => {},
    sideRef: { current: null },
    setSlot: () => {},
  };

  it('is a labelled toolbar with the side button and the phase primary', () => {
    const html = renderToStaticMarkup(
      createElement(LessonActionBar, {
        ...props,
        back: { kind: 'phase', label: 'Fase precedente: Esplora', to: 'explore' },
        primary: { kind: 'phase', label: 'Passa agli esercizi →', to: 'apply', quiet: false },
      }),
    );
    expect(html).toContain('role="toolbar"');
    expect(html).toContain('aria-label="Azioni della lezione"');
    expect(html).toContain('data-testid="lesson-open-side"');
    expect(html).toContain('aria-label="Fase precedente: Esplora"');
    expect(html).toContain('Passa agli esercizi →');
    expect(html).toContain('pb-[max(12px,env(safe-area-inset-bottom))]');
  });

  it('leaves an empty slot for the block and omits back and primary when there are none', () => {
    const html = renderToStaticMarkup(
      createElement(LessonActionBar, { ...props, back: null, primary: { kind: 'block' } }),
    );
    expect(html).not.toContain('Fase precedente');
    expect(html).toContain('<div class="flex min-w-0 flex-1"></div>');
    const none = renderToStaticMarkup(
      createElement(LessonActionBar, { ...props, back: null, primary: { kind: 'none' } }),
    );
    expect(none).toContain('lesson-open-side');
    expect(none).not.toContain('flex min-w-0 flex-1"></div>');
  });
});

describe('barHasSlot: the block draws in the bar only when the bar has room for it', () => {
  it('yes while studying an active lesson, standard or sprint, and in an older sprint lesson', () => {
    expect(barHasSlot(barPrimaryFor({ flow: 'standard', phase: 'understand', active: true }))).toBe(
      true,
    );
    expect(barHasSlot(barPrimaryFor({ flow: 'sprint', phase: 'theory', active: true }))).toBe(true);
    expect(barHasSlot(barPrimaryFor({ flow: 'legacy', phase: 'understand', active: true }))).toBe(
      true,
    );
  });

  it('no once the lesson is over: the way on stays in the page when re-reading Studia', () => {
    expect(
      barHasSlot(barPrimaryFor({ flow: 'standard', phase: 'understand', active: false })),
    ).toBe(false);
    expect(barHasSlot(barPrimaryFor({ flow: 'sprint', phase: 'theory', active: false }))).toBe(
      false,
    );
    expect(barHasSlot(barPrimaryFor({ flow: 'legacy', phase: 'understand', active: false }))).toBe(
      false,
    );
  });

  it('no in the phases that have their own primary', () => {
    expect(barHasSlot(barPrimaryFor({ flow: 'standard', phase: 'rework', active: true }))).toBe(
      false,
    );
    expect(barHasSlot(barPrimaryFor({ flow: 'standard', phase: 'recall', active: true }))).toBe(
      false,
    );
  });
});
