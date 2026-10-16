import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  ExamProfileDataSchema,
  RecurringTopicSchema,
  ExamItemDtoSchema,
  GenerateSimulationJobInputSchema,
  SaveAnswersRequestSchema,
} from '../src/simulation.js';

describe('GenerateSimulationJobInputSchema', () => {
  it('accepts a full exam without a topic', () => {
    expect(
      GenerateSimulationJobInputSchema.safeParse({
        subjectId: randomUUID(),
        mode: 'esame_completo',
      }).success,
    ).toBe(true);
  });

  it('rejects a drill without a topic', () => {
    const r = GenerateSimulationJobInputSchema.safeParse({
      subjectId: randomUUID(),
      mode: 'drill_argomento',
    });
    expect(r.success).toBe(false);
  });
});

describe('ExamItemDtoSchema — no answers leak during an attempt', () => {
  it('strips solution, rubric and expected points', () => {
    const parsed = ExamItemDtoSchema.parse({
      id: randomUUID(),
      ord: 0,
      prompt: 'Domanda',
      kind: 'open',
      points: 10,
      solution: 'SEGRETO',
      rubric: [{ criterion: 'x', points: 10 }],
      expectedPoints: ['y'],
    });
    expect(parsed).not.toHaveProperty('solution');
    expect(parsed).not.toHaveProperty('rubric');
    expect(parsed).not.toHaveProperty('expectedPoints');
  });
});

describe('SaveAnswersRequestSchema', () => {
  it('only accepts answers keyed by item uuid', () => {
    expect(
      SaveAnswersRequestSchema.safeParse({ answers: { [randomUUID()]: 'risposta' } }).success,
    ).toBe(true);
    expect(SaveAnswersRequestSchema.safeParse({ answers: { 'not-a-uuid': 'x' } }).success).toBe(
      false,
    );
  });
});

describe('RecurringTopicSchema / ExamProfileDataSchema', () => {
  it('parses legacy strings as { name, count: null } and keeps counted objects', () => {
    expect(RecurringTopicSchema.parse('Integrali')).toEqual({ name: 'Integrali', count: null });
    expect(RecurringTopicSchema.parse({ name: 'Serie', count: 5 })).toEqual({
      name: 'Serie',
      count: 5,
    });
    expect(RecurringTopicSchema.safeParse({ name: '', count: 1 }).success).toBe(false);
    expect(RecurringTopicSchema.safeParse({ name: 'x', count: 0 }).success).toBe(false);
  });

  it('accepts an old profile with string topics', () => {
    const parsed = ExamProfileDataSchema.parse({
      itemCount: 2,
      durationMin: 60,
      totalPoints: 20,
      kindDistribution: { open: 1 },
      avgMinutesPerItem: 30,
      verbosity: 'media',
      recurringTopics: ['entropia', { name: 'Fourier', count: 3 }],
      notes: '',
    });
    expect(parsed.recurringTopics).toEqual([
      { name: 'entropia', count: null },
      { name: 'Fourier', count: 3 },
    ]);
  });
});
