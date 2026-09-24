import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
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
