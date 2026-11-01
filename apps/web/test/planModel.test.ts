import { describe, expect, it } from 'vitest';
import type { PlanDto, TaskDto } from '@studyhub/contracts';
import {
  fitModel,
  lateTasks,
  formatLoad,
  planTopicOrder,
  stripPartSuffix,
  topicName,
  verifyOffset,
  weekOffsetFor,
  weekWindow,
  whenLabel,
} from '../src/components/plan/planModel';

function task(over: Partial<TaskDto>): TaskDto {
  return {
    id: 'id',
    planId: 'p',
    taskKey: 'lesson:a:01',
    date: '2026-10-30',
    kind: 'lesson',
    topicKey: 'a',
    topicId: null,
    minutes: 40,
    title: 'Limiti',
    description: '',
    payload: { action: 'lesson' },
    pinned: false,
    origin: 'planner',
    status: 'todo',
    flashcardCount: 0,
    ...over,
  };
}

function plan(over: Partial<PlanDto>, tasks: TaskDto[]): PlanDto {
  return {
    id: 'p',
    subjectId: 's',
    examId: null,
    status: 'active',
    startDate: '2026-10-28',
    targetDate: '2026-11-12',
    availability: { perWeekday: [0, 90, 90, 90, 90, 90, 0], blackoutDates: [] },
    prefs: {
      sessionLength: 50,
      intensity: 'standard',
      simulationCount: 'auto',
      simulationMinutes: 90,
      reviewMinutesPerCard: 0.5,
    },
    feasibility: {
      feasible: true,
      requiredMinutes: 300,
      availableMinutes: 600,
      shortfallMinutes: 0,
      unscheduledTopicKeys: [],
      sprintLessonKeys: [],
      excludedTopicKeys: [],
      strategies: [],
    },
    warnings: [],
    loadPerDay: [],
    tasks,
    createdAt: '2026-10-28T10:00:00.000Z',
    committedAt: null,
    ...over,
  } as PlanDto;
}

const names: Record<string, string> = { a: 'Limiti', b: 'Derivate', c: 'Integrali' };
const nameOf = (k: string) => names[k] ?? 'un argomento';

describe('stripPartSuffix / verifyOffset', () => {
  it('toglie il suffisso della parte', () => {
    expect(stripPartSuffix('Limiti · parte 1 di 2')).toBe('Limiti');
    expect(stripPartSuffix('Limiti')).toBe('Limiti');
  });
  it('ricava +3 e +7 dalla chiave della verifica', () => {
    expect(verifyOffset({ kind: 'verify', taskKey: 'rev:a:02' })).toBe(3);
    expect(verifyOffset({ kind: 'verify', taskKey: 'rev:a:03' })).toBe(7);
    expect(verifyOffset({ kind: 'verify', taskKey: 'rev:a:09' })).toBeNull();
    expect(verifyOffset({ kind: 'lesson', taskKey: 'rev:a:02' })).toBeNull();
  });
});

describe('weekWindow', () => {
  const p = { startDate: '2026-10-28', targetDate: '2026-11-12' };
  it('parte da oggi e si sposta a settimane', () => {
    const w = weekWindow(p, '2026-10-30', 0);
    expect(w.dates[0]).toBe('2026-10-30');
    expect(w.dates).toHaveLength(7);
    expect(w.hasToday).toBe(true);
    expect(w.canPrev).toBe(true);
    expect(w.canNext).toBe(true);
    const next = weekWindow(p, '2026-10-30', 1);
    expect(next.dates[0]).toBe('2026-11-06');
    expect(next.hasToday).toBe(false);
    expect(next.canNext).toBe(false);
  });
  it('parte dal primo giorno del piano se oggi è fuori', () => {
    const w = weekWindow(p, '2026-10-01', 0);
    expect(w.dates[0]).toBe('2026-10-28');
    expect(w.canPrev).toBe(false);
    expect(w.hasToday).toBe(false);
  });
});

describe('formatLoad', () => {
  it('riposo, assente e carico', () => {
    expect(formatLoad(undefined)).toBe('—');
    expect(formatLoad({ planned: 0, available: 0 })).toBe('riposo');
    expect(formatLoad({ planned: 130, available: 150 })).toBe('2 h 10 / 2 h 30');
  });
});

describe('fitModel', () => {
  it('entra tutto', () => {
    const m = fitModel(
      plan({}, [task({}), task({ taskKey: 'lesson:b:01', topicKey: 'b' })]),
      nameOf,
    );
    expect(m.tone).toBe('ok');
    expect(m.title).toBe('Entra tutto');
    expect(m.text).toContain('2 argomenti su 2');
    expect(m.hasProblem).toBe(false);
  });
  it('lezioni passate a sprint', () => {
    const p = plan(
      {
        feasibility: {
          ...plan({}, []).feasibility,
          sprintLessonKeys: ['lesson:b:01'],
        },
      },
      [
        task({}),
        task({
          taskKey: 'lesson:b:01',
          topicKey: 'b',
          title: 'Derivate',
          payload: { action: 'lesson', method: 'sprint' },
        }),
      ],
    );
    const m = fitModel(p, nameOf);
    expect(m.tone).toBe('warn');
    expect(m.text).toBe(
      '1 lezione passata a sprint perché il tempo non basta per tutto in standard: Derivate.',
    );
    expect(m.sprintTitles).toEqual(['Derivate']);
    expect(m.standardLessons).toBe(1);
  });
  it('argomenti esclusi per nome con i minuti mancanti', () => {
    const p = plan(
      {
        feasibility: {
          ...plan({}, []).feasibility,
          feasible: false,
          shortfallMinutes: 90,
          excludedTopicKeys: ['c'],
        },
      },
      [task({})],
    );
    const m = fitModel(p, nameOf);
    expect(m.tone).toBe('danger');
    expect(m.text).toBe('Resta fuori: Integrali. Mancano circa 1 h 30 min.');
  });
  it('tempo che non basta senza esclusi', () => {
    const p = plan(
      {
        feasibility: {
          ...plan({}, []).feasibility,
          feasible: false,
          shortfallMinutes: 60,
          requiredMinutes: 300,
        },
      },
      [task({})],
    );
    const m = fitModel(p, nameOf);
    expect(m.title).toBe('Il tempo non basta');
    expect(m.text).toBe('Mancano circa 1 h su 5 h richiesti.');
  });
});

describe('planTopicOrder', () => {
  it('ordina per data della prima lezione, poi esclusi in coda', () => {
    const p = plan(
      {
        feasibility: { ...plan({}, []).feasibility, excludedTopicKeys: ['c'] },
      },
      [
        task({
          id: '1',
          taskKey: 'lesson:b:01',
          topicKey: 'b',
          date: '2026-11-02',
          title: 'Derivate',
        }),
        task({
          id: '2',
          taskKey: 'lesson:a:01',
          topicKey: 'a',
          date: '2026-10-30',
          status: 'done',
        }),
        task({ id: '3', taskKey: 'lesson:a:02', topicKey: 'a', date: '2026-10-31' }),
        task({
          id: '4',
          taskKey: 'lesson:a:03',
          topicKey: 'a',
          date: '2026-10-31',
          status: 'moved',
        }),
      ],
    );
    const out = planTopicOrder(p, nameOf);
    expect(out.map((e) => e.key)).toEqual(['a', 'b', 'c']);
    expect(out[0]).toMatchObject({
      total: 2,
      done: 1,
      openDates: ['2026-10-31'],
      method: 'standard',
    });
    expect(out[2]).toMatchObject({ method: 'fuori', name: 'Integrali' });
  });
  it('metodo misto e sprint scelto dall’utente', () => {
    const p = plan({}, [
      task({ id: '1', taskKey: 'lesson:a:01' }),
      task({
        id: '2',
        taskKey: 'lesson:a:02',
        payload: { action: 'lesson', method: 'sprint' },
      }),
    ]);
    const [e] = planTopicOrder(p, nameOf);
    expect(e).toMatchObject({ method: 'misto', userSprint: true });
  });
});

describe('topicName / whenLabel', () => {
  it('risolve da argomenti, poi documenti', () => {
    expect(topicName('x', [{ id: 'x', name: 'Limiti' }], [])).toBe('Limiti');
    expect(topicName('d', [], [{ id: 'd', originalName: 'dispense.pdf' }])).toBe('dispense.pdf');
    expect(topicName('z', [], [])).toBe('un argomento');
  });
  it('oggi, domani, giorno e data', () => {
    expect(whenLabel([], '2026-10-30')).toBe('fatto');
    expect(whenLabel(['2026-10-30', '2026-10-31'], '2026-10-30')).toBe('oggi, domani');
    expect(whenLabel(['2026-11-02'], '2026-10-30')).toBe('lun');
    expect(whenLabel(['2026-11-20'], '2026-10-30')).toBe('20 nov');
    expect(whenLabel(['2026-10-30', '2026-10-31', '2026-11-01'], '2026-10-30')).toBe(
      'oggi, domani…',
    );
  });
});

describe('regole di correzione', () => {
  it('una lezione saltata non è fatta', () => {
    const p = plan({}, [
      task({ id: '1', taskKey: 'lesson:a:01', status: 'done' }),
      task({ id: '2', taskKey: 'lesson:a:02', status: 'skipped' }),
    ]);
    const [e] = planTopicOrder(p, nameOf);
    expect(e).toMatchObject({ total: 2, done: 1, openDates: [] });
  });
  it('stripPartSuffix tollera maiuscole e spazi', () => {
    expect(stripPartSuffix('Limiti  ·  Parte 2 di 3 ')).toBe('Limiti');
  });
  it('weekWindow apre l’ultima settimana se il piano è finito', () => {
    const w = weekWindow({ startDate: '2026-10-01', targetDate: '2026-10-20' }, '2026-11-05', 0);
    expect(w.dates[6]).toBe('2026-10-20');
    expect(w.canNext).toBe(false);
  });
  it('lateTasks e weekOffsetFor', () => {
    const p = plan({}, [
      task({ id: '1', date: '2026-10-29', status: 'todo' }),
      task({ id: '2', date: '2026-10-28', status: 'done' }),
    ]);
    expect(lateTasks(p, '2026-11-05').map((t) => t.id)).toEqual(['1']);
    expect(weekOffsetFor(p, '2026-10-30', '2026-11-08')).toBe(1);
  });
  it('fitModel segue il metodo effettivo', () => {
    const p = plan(
      { feasibility: { ...plan({}, []).feasibility, sprintLessonKeys: ['lesson:a:01'] } },
      [task({ taskKey: 'lesson:a:01' })], // the user switched it back to standard
    );
    const m = fitModel(p, nameOf);
    expect(m.sprintTitles).toEqual([]);
    expect(m.tone).toBe('ok');
    expect(m.text).toContain('in standard');
    const mixed = plan({}, [
      task({ id: '1', taskKey: 'lesson:a:01' }),
      task({ id: '2', taskKey: 'lesson:a:02', payload: { action: 'lesson', method: 'sprint' } }),
    ]);
    expect(fitModel(mixed, nameOf).text).toContain('standard e sprint (1 e 1)');
  });
});
