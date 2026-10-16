import { describe, expect, it } from 'vitest';
import { DEFAULT_POMODORO, type PomodoroState } from '@studyhub/core/browser';
import type { SessionDocumentDto, TaskDto } from '@studyhub/contracts';
import {
  drillItems,
  formatPageRanges,
  formatStudyTime,
  pickNextTask,
  ringDashOffset,
  sessionTitle,
  timerCaption,
} from '../src/lib/sessionMobile';

const config = DEFAULT_POMODORO;
const full = config.focusMin * 60_000;

function state(over: Partial<PomodoroState>): PomodoroState {
  return { phase: 'focus', completed: 0, remainingMs: full, ...over };
}

function task(over: Partial<TaskDto>): TaskDto {
  return {
    id: 'id',
    planId: 'p',
    taskKey: 'k',
    date: '2026-02-20',
    kind: 'read',
    topicKey: null,
    topicId: null,
    minutes: 30,
    title: 't',
    description: '',
    payload: { action: 'read' },
    pinned: false,
    origin: 'planner',
    status: 'todo',
    flashcardCount: 0,
    ...over,
  };
}

function doc(ranges: Array<[number, number]>): SessionDocumentDto {
  return {
    id: 'd',
    name: 'Integrali.pdf',
    pages: 20,
    highlighted: true,
    pageRanges: ranges.map(([pageFrom, pageTo]) => ({ pageFrom, pageTo })),
    topicIds: [],
    hasContent: true,
  };
}

describe('sessionMobile', () => {
  it('ring offset: full at the start, empty at the end, clamped', () => {
    expect(ringDashOffset(state({}), config)).toBe(0);
    expect(ringDashOffset(state({ remainingMs: full / 2 }), config)).toBeCloseTo(59.7, 5);
    expect(ringDashOffset(state({ remainingMs: 0 }), config)).toBeCloseTo(119.4, 5);
    expect(ringDashOffset(state({ remainingMs: full * 2 }), config)).toBe(0);
    expect(ringDashOffset(state({ remainingMs: -5 }), config)).toBeCloseTo(119.4, 5);
  });

  it('timer caption for focus, breaks and free mode', () => {
    expect(timerCaption('pomodoro', state({ completed: 1 }), config)).toBe(
      `Focus · pomodoro 2 di ${config.cyclesBeforeLong}`,
    );
    expect(timerCaption('pomodoro', state({ completed: config.cyclesBeforeLong }), config)).toBe(
      `Focus · pomodoro 1 di ${config.cyclesBeforeLong}`,
    );
    expect(timerCaption('pomodoro', state({ phase: 'short_break' }), config)).toBe('Pausa breve');
    expect(timerCaption('pomodoro', state({ phase: 'long_break' }), config)).toBe('Pausa lunga');
    expect(timerCaption('free', state({}), config)).toBe('Modalità libera');
  });

  it('formats study time', () => {
    expect(formatStudyTime(0)).toBe('0m');
    expect(formatStudyTime(20_000)).toBe('1m');
    expect(formatStudyTime(48 * 60_000)).toBe('48m');
    expect(formatStudyTime(60 * 60_000)).toBe('1h');
    expect(formatStudyTime(72 * 60_000)).toBe('1h 12m');
  });

  it('picks the next open task from today, skipping the current one and rest days', () => {
    const today = '2026-02-20';
    const tasks = [
      task({ id: 'old', date: '2026-02-19' }),
      task({ id: 'done', status: 'done' }),
      task({ id: 'skipped', status: 'skipped' }),
      task({ id: 'moved', status: 'moved' }),
      task({ id: 'rest', kind: 'rest' }),
      task({ id: 'current' }),
      task({ id: 'next', status: 'doing' }),
      task({ id: 'later' }),
    ];
    expect(pickNextTask(tasks, 'current', today)?.id).toBe('next');
    expect(pickNextTask(tasks, null, today)?.id).toBe('current');
    expect(pickNextTask([], null, today)).toBeNull();
    expect(pickNextTask([task({ id: 'x', status: 'done' })], null, today)).toBeNull();
  });

  it('formats page ranges', () => {
    expect(formatPageRanges(doc([[8, 8]]))).toBe('pagina 8');
    expect(formatPageRanges(doc([[8, 11]]))).toBe('pagine 8–11');
    expect(
      formatPageRanges(
        doc([
          [8, 11],
          [14, 14],
        ]),
      ),
    ).toBe('pagine 8–11, pagina 14');
    expect(formatPageRanges(doc([]))).toBe('');
  });

  it('titles a session like the desktop', () => {
    expect(sessionTitle({ taskTitle: 'Leggi', topics: [] })).toBe('Leggi');
    expect(
      sessionTitle({
        taskTitle: null,
        topics: [
          { id: 'a', name: 'Limiti' },
          { id: 'b', name: 'Integrali' },
        ],
      } as never),
    ).toBe('Limiti, Integrali');
    expect(sessionTitle({ taskTitle: null, topics: [] })).toBe('Studio libero');
  });

  it('keeps only cited wrong exercises for the drill', () => {
    const it = (kind: string, state: string, n: number) => ({
      kind,
      state,
      citations: Array(n).fill(1),
    });
    const items = [
      it('exercise', 'wrong', 1),
      it('exercise', 'wrong', 0),
      it('exercise', 'correct', 1),
      it('key_point', 'wrong', 1),
    ];
    expect(drillItems(items)).toEqual([items[0]]);
    expect(drillItems([])).toEqual([]);
  });
});
