import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { SessionBriefingDto, SessionItemDto } from '@studyhub/contracts';
import { ExerciseCard, SessionBriefing } from '@/components/SessionBriefing';
import { GuideQuestions } from '@/components/lesson/ApplyStep';

const UUID = '11111111-1111-4111-8111-111111111111';
const noop = () => {};

function item(over: Partial<SessionItemDto>): SessionItemDto {
  return {
    id: UUID,
    kind: 'exercise',
    orderIndex: 0,
    title: 'Calcola il limite',
    body: 'Soluzione attesa',
    difficulty: 2,
    citations: [],
    topicId: null,
    state: 'open',
    answer: null,
    feedback: null,
    linkedBlockIds: [],
    ...over,
  };
}

function render(
  items: SessionItemDto[],
  props: Partial<Parameters<typeof SessionBriefing>[0]> = {},
) {
  const client = new QueryClient();
  const data: SessionBriefingDto = { items, job: null, costEur: 0 };
  client.setQueryData(['sessionBriefing', 'mat', 'sess'], data);
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(SessionBriefing, {
        slug: 'mat',
        sessionId: 'sess',
        active: true,
        hasDocuments: true,
        onOpenCitation: noop,
        onAsk: noop,
        ...props,
      }),
    ),
  );
}

const keyPoint = item({
  id: '22222222-2222-4222-8222-222222222222',
  kind: 'key_point',
  title: 'KP',
});
const exercise = item({ id: '33333333-3333-4333-8333-333333333333' });
const guide = item({
  id: '44444444-4444-4444-8444-444444444444',
  kind: 'guide_question',
  title: 'Che cos’è un limite?',
  body: '',
  difficulty: null,
});

describe('SessionBriefing without a phase (unchanged)', () => {
  it('keeps the tabs and the counters', () => {
    const html = render([keyPoint, exercise]);
    expect(html).toContain('role="tablist"');
    expect(html).toContain('Punti chiave 0/1');
    expect(html).toContain('Esercizi (1)');
  });

  it('asks to generate key points and exercises when there is nothing yet', () => {
    const html = render([]);
    expect(html).toContain('Punti chiave ed esercizi');
    expect(html).toContain('Genera punti chiave ed esercizi');
  });

  it('keeps the old text without documents', () => {
    expect(render([], { hasDocuments: false })).toContain(
      'Nessun documento in questa sessione: scegli un argomento nella colonna a sinistra.',
    );
  });
});

describe('SessionBriefing with guide questions around', () => {
  it('does not count them: generation is still offered and they are no key points or exercises', () => {
    const html = render([guide]);
    expect(html).toContain('Genera punti chiave ed esercizi');
    expect(html).not.toContain('Che cos’è un limite?');
    expect(html).not.toContain('role="tablist"');
  });

  it('shows the tabs with the right counters, guide questions left out', () => {
    const html = render([guide, keyPoint, exercise]);
    expect(html).toContain('Punti chiave 0/1');
    expect(html).toContain('Esercizi (1)');
    expect(html).not.toContain('Che cos’è un limite?');
  });

  it('proposes more exercises (not a new batch of everything) once there are some', () => {
    const html = render([guide, keyPoint, exercise], { only: 'exercise' });
    expect(html).toContain('Altri esercizi');
  });
});

describe('SessionBriefing only="exercise" and footer', () => {
  it('drops the tabs and shows the exercises', () => {
    const html = render([keyPoint, exercise], { only: 'exercise' });
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain('Punti chiave 0/1');
    expect(html).toContain('Esercizio 1');
    expect(html).toContain('Calcola il limite');
  });

  it('renders the footer under the list and under the empty state', () => {
    const footer = () => createElement('p', null, 'IN FONDO');
    expect(render([exercise], { only: 'exercise', footer })).toContain('IN FONDO');
    const empty = render([guide], { only: 'exercise', footer });
    expect(empty).toContain('IN FONDO');
    expect(empty).toContain('Genera punti chiave ed esercizi');
  });

  it('shortens the no documents text', () => {
    const html = render([], { only: 'exercise', hasDocuments: false });
    expect(html).toContain('Nessun documento in questa sessione.');
    expect(html).not.toContain('colonna a sinistra');
  });
});

describe('ExerciseCard as a guide question', () => {
  const card = (variant: 'exercise' | 'guide', over: Partial<SessionItemDto> = {}) =>
    renderToStaticMarkup(
      createElement(ExerciseCard, {
        item: variant === 'guide' ? { ...guide, ...over } : { ...exercise, ...over },
        index: 0,
        variant,
        active: true,
        grading: false,
        gradeError: null,
        onPatch: noop,
        onGrade: noop,
        onOpenCitation: noop,
      }),
    );

  it('has the guide heading, placeholder and aria-label, with no solution and no self-assessment', () => {
    const html = card('guide');
    expect(html).toContain('Domanda guida 1');
    expect(html).toContain('Rispondi con parole tue…');
    expect(html).toContain('aria-label="Risposta alla domanda guida 1"');
    expect(html).toContain('Correggi con l’AI');
    expect(html).not.toContain('Mostra la soluzione');
    expect(html).not.toContain('Soluzione');
    expect(html).not.toContain('Ho risposto bene');
    expect(html).not.toContain('Facile');
  });

  it('keeps the AI correction of a guide question', () => {
    const html = card('guide', {
      answer: 'Il valore a cui tende',
      feedback: {
        score: 0.8,
        feedback: 'Quasi.',
        missing: ['il limite destro'],
        model: 'fake',
        gradedAt: '2026-10-30T10:00:00.000Z',
      },
    });
    expect(html).toContain('80%');
    expect(html).toContain('Manca: il limite destro');
    expect(html).not.toContain('Ho risposto bene');
  });

  it('leaves the exercise as it was', () => {
    const html = card('exercise');
    expect(html).toContain('Esercizio 1');
    expect(html).toContain('Mostra la soluzione');
    expect(html).toContain('Scrivi qui il tuo svolgimento…');
  });
});

describe('GuideQuestions (Applica)', () => {
  const api = (guideQuestions: SessionItemDto[]) =>
    ({
      guideQuestions,
      grade: { isPending: false, isError: false, variables: undefined, error: null, mutate: noop },
      patch: { mutate: noop },
    }) as never;
  const render2 = (guideQuestions: SessionItemDto[]) =>
    renderToStaticMarkup(
      createElement(GuideQuestions, {
        api: api(guideQuestions),
        active: true,
        onOpenCitation: noop,
      }),
    );

  it('shows nothing without guide questions', () => {
    expect(render2([])).toBe('');
  });

  it('shows the section and one card per question, in order', () => {
    const second = { ...guide, id: UUID, orderIndex: 1, title: 'Seconda domanda' };
    const html = render2([second, guide]);
    expect(html).toContain('Ora rispondi alle domande guida');
    expect(html).toContain('Domanda guida 1');
    expect(html).toContain('Domanda guida 2');
    expect(html.indexOf('Che cos’è un limite?')).toBeLessThan(html.indexOf('Seconda domanda'));
  });
});
