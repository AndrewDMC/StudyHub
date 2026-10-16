import { describe, expect, it } from 'vitest';
import { TaskDtoSchema, UpdateTaskFlashcardsRequestSchema } from '../src/plan.js';
import { ReviewQueueQuerySchema } from '../src/review.js';

const uuid = '3f1b6a2e-5c1d-4d7e-9a35-0d2f6b8c4e11';

describe('task flashcards contracts', () => {
  it('TaskDto defaults flashcardCount to 0 when absent', () => {
    const parsed = TaskDtoSchema.parse({
      id: uuid,
      planId: uuid,
      taskKey: 'read:a:001',
      date: '2026-10-16',
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
    });
    expect(parsed.flashcardCount).toBe(0);
  });

  it('UpdateTaskFlashcardsRequest needs at least one id', () => {
    expect(UpdateTaskFlashcardsRequestSchema.safeParse({}).success).toBe(false);
    expect(UpdateTaskFlashcardsRequestSchema.safeParse({ add: [] }).success).toBe(false);
    expect(UpdateTaskFlashcardsRequestSchema.safeParse({ add: [uuid] }).success).toBe(true);
    expect(UpdateTaskFlashcardsRequestSchema.safeParse({ remove: ['x'] }).success).toBe(false);
  });

  it('ReviewQueueQuery accepts task as uuid', () => {
    expect(ReviewQueueQuerySchema.safeParse({ materia: 'a', task: uuid }).success).toBe(true);
    expect(ReviewQueueQuerySchema.safeParse({ task: 'nope' }).success).toBe(false);
  });
});
