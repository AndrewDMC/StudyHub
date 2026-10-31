import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ExplanationDto,
  ExplanationStateDto,
  SessionDocumentDto,
  SessionItemDto,
} from '@studyhub/contracts';
import { PhaseStepper } from '@/components/lesson/PhaseStepper';
import { PhaseNav } from '@/components/lesson/PhaseNav';
import { FeedbackPoints } from '@/components/lesson/FeedbackPoints';
import { ExplainStepView } from '@/components/lesson/ExplainStep';
import { ExploreStepView, lessonDocuments } from '@/components/lesson/ExploreStep';
import { lessonAllDone } from '@/components/lesson/LessonStudy';
import { recallSummary } from '@/components/lesson/RecallStep';
import {
  LESSON_PHASES,
  NEXT_ACTION,
  canSubmitExplanation,
  explanationUiState,
  formatPageRanges,
  guideQuestionsOf,
  initialViewPhase,
  isStandardPhase,
  phaseIndex,
  previousPhase,
  readFurthest,
  stepStatus,
  usesLessonFlow,
  writeFurthest,
  type PhaseProgress,
} from '@/lib/lessonClient';

const UUID = '11111111-1111-4111-8111-111111111111';
const UUID2 = '22222222-2222-4222-8222-222222222222';
const noop = () => {};

function progress(over: Partial<PhaseProgress> = {}): PhaseProgress {
  return {
    furthest: 0,
    blocks: [],
    blockCount: null,
    explanationGraded: false,
    exercisesAnswered: 0,
    ended: false,
    ...over,
  };
}

function item(over: Partial<SessionItemDto>): SessionItemDto {
  return {
    id: UUID,
    kind: 'key_point',
    orderIndex: 0,
    title: 'Titolo',
    body: '',
    difficulty: null,
    citations: [],
    topicId: null,
    state: 'open',
    answer: null,
    feedback: null,
    linkedBlockIds: [],
    concepts: [],
    solutionSteps: [],
    solutionVisible: true,
    parentItemId: null,
    ...over,
  };
}

describe('phases of the standard lesson', () => {
  it('has the five phases in order', () => {
    expect(LESSON_PHASES.map((p) => p.id)).toEqual([
      'explore',
      'understand',
      'rework',
      'apply',
      'recall',
    ]);
    expect(LESSON_PHASES.map((p) => p.label)).toEqual([
      'Esplora',
      'Studia',
      'Rielabora',
      'Applica',
      'Ricorda',
    ]);
  });

  it('tells standard phases from sprint ones and from none', () => {
    expect(isStandardPhase('rework')).toBe(true);
    expect(isStandardPhase('exercises')).toBe(false);
    expect(isStandardPhase(null)).toBe(false);
    expect(phaseIndex('apply')).toBe(3);
    expect(phaseIndex('theory')).toBe(-1);
    expect(phaseIndex(null)).toBe(-1);
  });

  it('opens on the saved phase, on Esplora when it is missing, on Ricorda when the session is over', () => {
    expect(initialViewPhase({ status: 'active', phase: 'rework' })).toBe('rework');
    expect(initialViewPhase({ status: 'active', phase: 'exercises' })).toBe('explore');
    expect(initialViewPhase({ status: 'ended', phase: 'understand' })).toBe('recall');
  });

  it('mounts the shell for standard lessons, for sprint phases and for an old sprint in Studia', () => {
    const s = (
      method: 'standard' | 'sprint',
      phase: never,
      kind: 'lesson' | 'verify' = 'lesson',
    ) => ({
      kind,
      method,
      phase,
    });
    expect(usesLessonFlow(s('standard', 'explore' as never))).toBe(true);
    expect(usesLessonFlow(s('standard', 'recall' as never))).toBe(true);
    expect(usesLessonFlow(s('sprint', 'understand' as never))).toBe(true);
    expect(usesLessonFlow(s('sprint', 'exercises' as never))).toBe(true);
    expect(usesLessonFlow(s('sprint', null as never))).toBe(false);
    expect(usesLessonFlow(s('standard', null as never))).toBe(false);
    expect(usesLessonFlow(s('standard', 'explore' as never, 'verify'))).toBe(false);
  });

  it('has a back and a forward target for every phase but the ends', () => {
    expect(previousPhase('explore')).toBeNull();
    expect(previousPhase('rework')?.id).toBe('understand');
    expect(NEXT_ACTION.explore).toEqual({ label: 'Inizia a studiare →', to: 'understand' });
    expect(NEXT_ACTION.understand?.to).toBe('rework');
    expect(NEXT_ACTION.rework?.to).toBe('apply');
    expect(NEXT_ACTION.apply?.to).toBe('recall');
    expect(NEXT_ACTION.recall).toBeNull();
  });
});

describe('step status ("fatta" / corrente / da fare)', () => {
  it('the current phase wins over done', () => {
    expect(stepStatus('explore', 'explore', progress({ furthest: 3 }))).toBe('current');
  });

  it('phases before the furthest one are done', () => {
    const p = progress({ furthest: 3 });
    expect(stepStatus('explore', 'recall', p)).toBe('done');
    expect(stepStatus('rework', 'recall', p)).toBe('done');
    expect(stepStatus('apply', 'recall', p)).toBe('todo');
  });

  it('uses the data when the student has not been past the phase', () => {
    expect(
      stepStatus(
        'understand',
        'explore',
        progress({ blockCount: 2, blocks: [{ state: 'done' }, { state: 'done' }] }),
      ),
    ).toBe('done');
    expect(
      stepStatus(
        'understand',
        'explore',
        progress({ blockCount: 2, blocks: [{ state: 'done' }, { state: 'open' }] }),
      ),
    ).toBe('todo');
    expect(stepStatus('rework', 'explore', progress({ explanationGraded: true }))).toBe('done');
    expect(stepStatus('apply', 'explore', progress({ exercisesAnswered: 1 }))).toBe('done');
    expect(stepStatus('recall', 'explore', progress({ ended: true }))).toBe('done');
  });

  it('lessonAllDone needs every block written and passed', () => {
    expect(lessonAllDone(undefined)).toBe(false);
    expect(lessonAllDone({ blockCount: null, blocks: [] })).toBe(false);
    expect(lessonAllDone({ blockCount: 2, blocks: [{ state: 'done' }] as never })).toBe(false);
    expect(
      lessonAllDone({ blockCount: 2, blocks: [{ state: 'done' }, { state: 'done' }] as never }),
    ).toBe(true);
  });
});

describe('furthest phase kept on the device', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubStorage(store: Record<string, string>) {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => {
          store[k] = v;
        },
      },
    });
  }

  it('reads what was written, never below the saved phase', () => {
    const store: Record<string, string> = {};
    stubStorage(store);
    expect(readFurthest('s1', null)).toBe(0);
    writeFurthest('s1', 3);
    expect(readFurthest('s1', 'understand')).toBe(3);
    expect(readFurthest('s2', 'apply')).toBe(3);
    store['lesson-furthest:s3'] = 'rubbish';
    expect(readFurthest('s3', 'rework')).toBe(2);
  });

  it('falls back on the saved phase when storage throws', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {
          throw new Error('blocked');
        },
      },
    });
    expect(readFurthest('s1', 'rework')).toBe(2);
    expect(() => writeFurthest('s1', 2)).not.toThrow();
  });
});

describe('PhaseStepper', () => {
  function render(current: Parameters<typeof PhaseStepper>[0]['current'], p = progress()) {
    return renderToStaticMarkup(
      createElement(PhaseStepper, { current, progress: p, onSelect: noop }),
    );
  }

  it('is a nav with five native buttons, in order', () => {
    const html = render('explore');
    expect(html).toContain('aria-label="Fasi della lezione"');
    expect(html.match(/<button/g)).toHaveLength(5);
    const order = ['Esplora', 'Studia', 'Rielabora', 'Applica', 'Ricorda'].map((l) =>
      html.indexOf(l),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((i) => i >= 0)).toBe(true);
  });

  it('marks only the current step and says the state in words', () => {
    const html = render('rework', progress({ furthest: 2 }));
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).toContain('Rielabora<span class="sr-only">, fase corrente</span>');
    expect(html).toContain('Esplora<span class="sr-only">, fatta</span>');
    expect(html).toContain('Applica<span class="sr-only">, da fare</span>');
  });

  it('never locks a step that was not reached', () => {
    const html = render('explore');
    expect(html).not.toContain('disabled');
    expect(html).not.toContain('aria-disabled');
  });
});

describe('PhaseNav', () => {
  const render = (phase: Parameters<typeof PhaseNav>[0]['phase']) =>
    renderToStaticMarkup(createElement(PhaseNav, { phase, onGo: noop }));

  it('has only forward on the first phase and only back on the last', () => {
    const first = render('explore');
    expect(first).toContain('Inizia a studiare →');
    expect(first).not.toContain('Indietro');
    const last = render('recall');
    expect(last).toContain('aria-label="Indietro: Applica"');
    expect(last).not.toContain('→');
  });

  it('labels the forward button of each step', () => {
    expect(render('understand')).toContain('Passa a Rielabora →');
    expect(render('rework')).toContain('Passa agli esercizi →');
    expect(render('apply')).toContain('Ho finito · chiudi la lezione →');
  });
});

describe('Esplora', () => {
  const doc = (over: Partial<SessionDocumentDto>): SessionDocumentDto => ({
    id: UUID,
    name: 'Dispense.pdf',
    pages: 40,
    highlighted: false,
    pageRanges: [],
    topicIds: [],
    hasContent: true,
    ...over,
  });

  it('keeps only the documents of the task when there are some', () => {
    const a = doc({ id: UUID, highlighted: true });
    const b = doc({ id: UUID2, name: 'Altro.pdf' });
    expect(lessonDocuments([a, b])).toEqual([a]);
    expect(lessonDocuments([b])).toEqual([b]);
  });

  it('formats page ranges', () => {
    expect(formatPageRanges([])).toBe('');
    expect(formatPageRanges([{ pageFrom: 4, pageTo: 4 }])).toBe('p. 4');
    expect(
      formatPageRanges([
        { pageFrom: 3, pageTo: 7 },
        { pageFrom: 9, pageTo: 9 },
      ]),
    ).toBe('p. 3–7, 9');
  });

  it('keeps only the guide questions, in order', () => {
    const items = [
      item({ id: UUID, kind: 'key_point', title: 'KP' }),
      item({ id: UUID2, kind: 'guide_question', orderIndex: 1, title: 'Seconda' }),
      item({ kind: 'exercise', title: 'EX' }),
      item({ kind: 'explanation', title: 'EXPL' }),
      item({ id: '33333333-3333-4333-8333-333333333333', kind: 'guide_question', title: 'Prima' }),
    ];
    expect(guideQuestionsOf(items).map((i) => i.title)).toEqual(['Prima', 'Seconda']);
  });

  const view = (over: Partial<Parameters<typeof ExploreStepView>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(ExploreStepView, {
        docs: [
          doc({
            highlighted: true,
            pageRanges: [{ pageFrom: 3, pageTo: 7 }],
          }),
        ],
        blockTitles: ['Il limite', 'La derivata'],
        blockCount: 3,
        questions: [{ id: UUID, title: 'Che cos’è un limite?' }],
        status: 'ready',
        error: null,
        canAsk: true,
        onOpenDocument: noop,
        onAskQuestion: noop,
        ...over,
      }),
    );

  it('shows documents with pages, the index of the blocks and the guide questions', () => {
    const html = view();
    expect(html).toContain('Prima di leggere: guarda la struttura');
    expect(html).toContain('Dispense.pdf');
    expect(html).toContain('p. 3–7');
    expect(html).toContain('La lezione · 3 blocchi');
    expect(html).toContain('Il limite');
    expect(html).toContain('Blocco 3');
    expect(html).toContain('Che cos’è un limite?');
    expect(html).toContain('Una tua domanda (facoltativa)');
  });

  it('says the questions arrive with the first block while it is being written', () => {
    const html = view({ status: 'preparing', blockTitles: [], blockCount: null, questions: [] });
    expect(html).toContain('Le domande guida arrivano insieme al primo blocco della lezione.');
    expect(html).toContain('Sto preparando la lezione dal materiale…');
  });

  it('says so when a generated lesson has no questions, and when it was never generated', () => {
    expect(view({ questions: [] })).toContain('Questa lezione non ha domande guida.');
    const ended = view({
      status: 'not_generated',
      blockTitles: [],
      blockCount: null,
      questions: [],
      canAsk: false,
    });
    expect(ended).toContain('Questa lezione non è stata generata.');
    expect(ended).not.toContain('Una tua domanda');
  });

  it('shows the retry when the first block failed, none when the budget is over', () => {
    const failed = view({
      error: { message: 'boom', retrying: false, onRetry: noop },
    });
    expect(failed).toContain('Non sono riuscito a preparare la lezione: boom');
    expect(failed).toContain('Riprova');
    const budget = view({
      error: { message: 'Budget AI giornaliero esaurito', retrying: false, onRetry: noop },
    });
    expect(budget).toContain('budget AI');
    expect(budget).not.toContain('Riprova');
  });

  it('shows an alert with retry when the lesson cannot be loaded', () => {
    const html = view({
      status: 'load_error',
      blockTitles: [],
      blockCount: null,
      questions: [],
      error: { message: 'Impossibile caricare la lezione', retrying: false, onRetry: noop },
    });
    expect(html).toContain('role="alert"');
    expect(html).toContain('Impossibile caricare la lezione');
    expect(html).toContain('Riprova');
    expect(html).not.toContain('Sto preparando la lezione');
  });

  it('has no documents message', () => {
    expect(view({ docs: [] })).toContain('Nessun documento collegato a questa lezione.');
  });
});

describe('Rielabora', () => {
  const text = 'Il limite descrive il valore a cui si avvicina la funzione.';
  const cite = {
    docId: UUID,
    documentName: 'Dispense.pdf',
    page: 4,
    quote: 'il limite è il valore a cui tende',
  };
  const feedback: NonNullable<ExplanationDto['feedback']> = {
    correct: [{ text: 'Hai colto l’idea di avvicinamento.', citation: cite }],
    missing: [{ text: 'Non hai detto del limite destro e sinistro.', citation: null }],
    wrong: [],
    model: 'fake',
    gradedAt: '2026-10-30T10:00:00.000Z',
  };
  const latest = (over: Partial<ExplanationDto> = {}): ExplanationDto => ({
    id: UUID,
    text,
    createdAt: '2026-10-30T09:59:00.000Z',
    feedback: null,
    ...over,
  });
  const state = (
    l: ExplanationDto | null,
    job: ExplanationStateDto['job'] = null,
  ): ExplanationStateDto => ({ latest: l, job });
  const job = (
    status: 'queued' | 'running' | 'succeeded' | 'failed',
    error: string | null = null,
  ) => ({ id: UUID2, status, error }) as const;

  describe('state', () => {
    it('is empty without an explanation', () => {
      expect(explanationUiState(state(null), { active: true })).toBe('empty');
      expect(explanationUiState(undefined, { active: true })).toBe('empty');
    });
    it('is pending while the job is queued or running', () => {
      expect(explanationUiState(state(latest(), job('queued')), { active: true })).toBe('pending');
      expect(explanationUiState(state(latest(), job('running')), { active: true })).toBe('pending');
    });
    it('is done with a comparison, and without one when the job is over', () => {
      expect(
        explanationUiState(state(latest({ feedback }), job('succeeded')), { active: true }),
      ).toBe('done');
      expect(explanationUiState(state(latest(), job('succeeded')), { active: true })).toBe(
        'nofeedback',
      );
    });
    it('tells a failure from the budget being over', () => {
      expect(explanationUiState(state(latest(), job('failed', 'boom')), { active: true })).toBe(
        'failed',
      );
      expect(
        explanationUiState(state(latest(), job('failed', 'Budget AI esaurito')), { active: true }),
      ).toBe('budget');
      expect(explanationUiState(state(null), { active: true, submitError: 'Budget AI' })).toBe(
        'budget',
      );
      expect(
        explanationUiState(state(null), { active: true, submitError: 'Sessione finita' }),
      ).toBe('failed');
    });
    it('is ended when the session is over', () => {
      expect(explanationUiState(state(latest({ feedback })), { active: false })).toBe('ended');
    });
  });

  describe('submit rule', () => {
    const busy = { busy: false, active: true };
    it('needs 20 characters', () => {
      expect(canSubmitExplanation('troppo corto', null, busy)).toBe(false);
      expect(canSubmitExplanation(text, null, busy)).toBe(true);
    });
    it('is off for the text already compared, on once it changes', () => {
      expect(canSubmitExplanation(text, latest(), busy)).toBe(false);
      expect(canSubmitExplanation(`${text} E poi altro.`, latest(), busy)).toBe(true);
    });
    it('is off while busy or when the session is over', () => {
      expect(canSubmitExplanation(text, null, { busy: true, active: true })).toBe(false);
      expect(canSubmitExplanation(text, null, { busy: false, active: false })).toBe(false);
    });
  });

  const view = (over: Partial<Parameters<typeof ExplainStepView>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(ExplainStepView, {
        slug: 'analisi-2',
        ui: 'empty',
        latest: null,
        text: '',
        onTextChange: noop,
        canSubmit: false,
        submitting: false,
        errorMessage: null,
        onSubmit: noop,
        onRetry: noop,
        onOpenCitation: noop,
        ...over,
      }),
    );

  it('empty: textarea, counter and a disabled button', () => {
    const html = view();
    expect(html).toContain('Rendilo tuo');
    expect(html).toContain('0 caratteri · almeno 20');
    expect(html).toContain('Confronta con il materiale');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Confronta con il materiale/);
    expect(html).not.toContain('Confronto con il materiale</p>');
  });

  it('has the Schema link to the Schemi tab, opening in a new tab', () => {
    const html = view();
    expect(html).toContain('href="/materie/analisi-2?tab=schemi"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('(si apre in una nuova scheda)');
    expect(html).toContain('role="radiogroup"');
  });

  it('pending: read-only box and the waiting message', () => {
    const html = view({ ui: 'pending', latest: latest(), text });
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('readOnly=""');
    expect(html).toContain('Sto confrontando la tua spiegazione con il materiale…');
    expect(html).toContain('role="status"');
  });

  it('done: the three rows, the citation as a button, "Senza fonte" without one', () => {
    const html = view({ ui: 'done', latest: latest({ feedback }), text: `${text} Altro.` });
    expect(html).toContain('Correggi e riprova');
    for (const label of ['Giusto', 'Manca', 'Attento']) expect(html).toContain(label);
    expect(html).toContain('↗ Dispense.pdf · p. 4');
    expect(html).toContain('Senza fonte');
    expect(html).toContain('Nessun errore trovato.');
    expect(html).toContain('Modello: fake');
  });

  it('done with the same text asks to change it', () => {
    const html = view({ ui: 'done', latest: latest({ feedback }), text });
    expect(html).toContain('Modifica la spiegazione per riprovare.');
  });

  it('failed: alert with the reason and retry, the text stays', () => {
    const html = view({ ui: 'failed', latest: latest(), text, errorMessage: 'boom' });
    expect(html).toContain('role="alert"');
    expect(html).toContain('Non sono riuscito a confrontare la spiegazione: boom');
    expect(html).toContain('Riprova');
    expect(html).toContain(text);
  });

  it('budget: explanation without retry', () => {
    const html = view({ ui: 'budget', latest: latest(), text });
    expect(html).toContain('Hai raggiunto il budget AI di oggi');
    expect(html).not.toContain('Riprova');
  });

  it('nofeedback: says it and offers retry', () => {
    const html = view({ ui: 'nofeedback', latest: latest(), text });
    expect(html).toContain('Il confronto non è disponibile.');
    expect(html).toContain('Riprova');
  });

  it('ended: read-only text and the comparison, no submit button', () => {
    const html = view({ ui: 'ended', latest: latest({ feedback }) });
    expect(html).toContain(text);
    expect(html).toContain('Giusto');
    expect(html).not.toContain('Confronta con il materiale');
    expect(html).not.toContain('Correggi e riprova');
    expect(view({ ui: 'ended' })).toContain('Non hai scritto una spiegazione in questa lezione.');
  });

  it('FeedbackPoints always shows the three rows, even empty', () => {
    const html = renderToStaticMarkup(
      createElement(FeedbackPoints, {
        feedback: { correct: [], missing: [], wrong: [] },
        onOpenCitation: noop,
      }),
    );
    expect(html).toContain('Per ora niente in comune con il materiale');
    expect(html).toContain('Non manca niente di importante.');
    expect(html).toContain('Nessun errore trovato.');
  });
});

describe('Ricorda', () => {
  it('summarises only what is not zero', () => {
    expect(recallSummary({ activeMs: 0, keyPoints: 0, right: 0, answered: 0 })).toBe(
      'Appena chiudi, qui trovi il riepilogo.',
    );
    expect(recallSummary({ activeMs: 25 * 60_000, keyPoints: 6, right: 2, answered: 3 })).toBe(
      '25 min di studio reale · 6 punti chiave · 2 esercizi su 3 corretti',
    );
    expect(recallSummary({ activeMs: 0, keyPoints: 4, right: 0, answered: 0 })).toBe(
      '4 punti chiave',
    );
  });
});
