import { describe, expect, it } from 'vitest';
import {
  GenerateLessonBlockJobInputSchema,
  JobTypeSchema,
  SessionItemDtoSchema,
  SessionItemKindSchema,
  SessionItemStateSchema,
  TaskPayloadSchema,
  UpdateSessionItemRequestSchema,
  normalizeConcept,
} from '../src/index.js';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('sprint lesson contracts', () => {
  it('knows the retry kind, the "non so" state and the new job', () => {
    expect(SessionItemKindSchema.parse('retry_exercise')).toBe('retry_exercise');
    expect(SessionItemStateSchema.parse('unknown')).toBe('unknown');
    expect(JobTypeSchema.parse('generate_sprint_exercises')).toBe('generate_sprint_exercises');
  });

  it('an item without the sprint fields still parses, with neutral defaults', () => {
    const item = SessionItemDtoSchema.parse({
      id: UUID,
      kind: 'exercise',
      orderIndex: 0,
      title: 'Calcola',
      body: 'Soluzione',
      difficulty: 2,
      citations: [],
      topicId: null,
      state: 'open',
      answer: null,
      feedback: null,
    });
    expect(item).toMatchObject({
      concepts: [],
      solutionSteps: [],
      solutionVisible: true,
      parentItemId: null,
      linkedBlockIds: [],
    });
  });

  it('an item update can just ask to reveal the solution', () => {
    expect(UpdateSessionItemRequestSchema.parse({ revealSolution: true })).toEqual({
      revealSolution: true,
    });
    expect(UpdateSessionItemRequestSchema.safeParse({ revealSolution: false }).success).toBe(false);
    expect(UpdateSessionItemRequestSchema.safeParse({}).success).toBe(false);
  });

  it('a block job may carry the focus of a sprint lesson', () => {
    const base = { subjectId: UUID, sessionId: UUID, blockIndex: 0 };
    expect(GenerateLessonBlockJobInputSchema.parse(base).focus).toBeUndefined();
    const withFocus = GenerateLessonBlockJobInputSchema.parse({
      ...base,
      focus: { concept: 'Lavoro di una forza', exercise: 'Calcola il lavoro' },
    });
    expect(withFocus.focus).toEqual({
      concept: 'Lavoro di una forza',
      exercise: 'Calcola il lavoro',
    });
    expect(
      GenerateLessonBlockJobInputSchema.safeParse({ ...base, focus: { concept: '', exercise: '' } })
        .success,
    ).toBe(false);
  });

  it('a lesson payload keeps the minutes of both methods', () => {
    const payload = TaskPayloadSchema.parse({
      action: 'lesson',
      method: 'standard',
      minutesByMethod: { standard: 60, sprint: 40 },
    });
    expect(payload.minutesByMethod).toEqual({ standard: 60, sprint: 40 });
  });

  it('normalises concept titles to compare them', () => {
    expect(normalizeConcept('  Lavoro   di una Forza. ')).toBe('lavoro di una forza');
    expect(normalizeConcept('Energia cinetica')).toBe(normalizeConcept('energia  cinetica!'));
  });
});
