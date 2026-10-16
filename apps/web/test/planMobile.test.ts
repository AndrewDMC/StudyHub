import { describe, expect, it } from 'vitest';
import type { PlanDto, TaskDto } from '@studyhub/contracts';
import {
  addDaysIso,
  averageMinutes,
  dayRange,
  defaultDay,
  excludableTopics,
  formatDayTitle,
  formatDuration,
  formatUntil,
  kindColor,
  overdueTasks,
  planProgress,
  scaleAvailability,
} from '../src/lib/planMobile';

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

function plan(tasks: TaskDto[], status: PlanDto['status'] = 'active'): PlanDto {
  return { status, tasks } as PlanDto;
}

describe('planMobile', () => {
  it('counts progress without rest days', () => {
    const p = planProgress([
      task({ status: 'done' }),
      task({ status: 'todo' }),
      task({ kind: 'rest', status: 'done' }),
      task({ status: 'moved' }),
    ]);
    expect(p).toEqual({ total: 2, done: 1 });
  });

  it('maps kinds to colours', () => {
    expect(kindColor('read')).toBe('accent');
    expect(kindColor('flashcards')).toBe('subject');
    expect(kindColor('rest')).toBe('muted');
  });

  it('finds the overdue tasks of an active plan, oldest first', () => {
    const p = plan([
      task({ id: 'a', taskKey: 'a', date: '2026-02-19' }),
      task({ id: 'b', taskKey: 'b', date: '2026-02-18' }),
      task({ id: 'c', taskKey: 'c', date: '2026-02-18', status: 'done' }),
      task({ id: 'd', taskKey: 'd' }),
    ]);
    expect(overdueTasks(p, ['a', 'b', 'c'], '2026-02-20').map((t) => t.id)).toEqual(['b', 'a']);
    expect(overdueTasks(plan(p.tasks, 'draft'), ['a'], '2026-02-20')).toEqual([]);
    expect(overdueTasks(null, ['a'], '2026-02-20')).toEqual([]);
  });

  it('ignores future and older-than-a-week tasks sharing a key with another active plan', () => {
    // Drift covers every active plan: a key flagged overdue in plan A may be a future task here.
    const p = plan([
      task({ id: 'past', taskKey: 'k1', date: '2026-02-18' }),
      task({ id: 'future', taskKey: 'k1', date: '2026-02-25' }),
      task({ id: 'today', taskKey: 'k1', date: '2026-02-20' }),
      task({ id: 'old', taskKey: 'k1', date: '2026-02-10' }),
    ]);
    expect(overdueTasks(p, ['k1'], '2026-02-20').map((t) => t.id)).toEqual(['past']);
  });

  it('adds days across month and year boundaries', () => {
    expect(addDaysIso('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDaysIso('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('builds a continuous day range and picks the default day', () => {
    const days = dayRange([task({ date: '2026-02-20' }), task({ date: '2026-02-23' })]);
    expect(days).toEqual(['2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23']);
    expect(dayRange([])).toEqual([]);
    expect(defaultDay(days, '2026-02-22')).toBe('2026-02-22');
    expect(defaultDay(days, '2026-02-01')).toBe('2026-02-20');
    expect(defaultDay(days, '2026-03-01')).toBe('2026-02-23');
    expect(defaultDay([], '2026-02-22')).toBeNull();
  });

  it('averages and scales availability keeping zero days', () => {
    const week = [0, 90, 90, 90, 90, 90, 60];
    expect(averageMinutes(week)).toBe(85);
    expect(averageMinutes([0, 0, 0, 0, 0, 0, 0])).toBe(0);
    const scaled = scaleAvailability(week, 170);
    expect(scaled[0]).toBe(0);
    expect(scaled[1]).toBe(180);
    expect(scaleAvailability([0, 0, 0, 0, 0, 0, 0], 60)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(scaleAvailability([0, 30, 0, 0, 0, 0, 0], 100000)[1]).toBe(1440);
  });

  it('extracts excludable topics from read tasks', () => {
    const p = plan([
      task({ topicKey: 'a', title: 'Studia Limiti — pp. 1-10' }),
      task({ topicKey: 'a', title: 'Studia Limiti — pp. 11-20' }),
      task({ topicKey: 'b', title: 'Studia Derivate' }),
      task({ topicKey: 'c', kind: 'flashcards', title: 'Flashcard' }),
    ]);
    expect(excludableTopics(p)).toEqual([
      { key: 'a', label: 'Limiti' },
      { key: 'b', label: 'Derivate' },
    ]);
  });

  it('formats durations and dates', () => {
    expect(formatDuration(130)).toBe('2h 10m');
    expect(formatDuration(120)).toBe('2h');
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(0)).toBe('—');
    expect(formatDayTitle('2026-02-20', '2026-02-20')).toBe('Oggi');
    expect(formatDayTitle('2026-02-23', '2026-02-20')).toBe('Lunedì 23 febbraio');
    expect(formatUntil('2026-02-12', 2026)).toBe('Fino al 12 febbraio');
    expect(formatUntil('2027-02-12', 2026)).toBe('Fino al 12 febbraio 2027');
  });
});
