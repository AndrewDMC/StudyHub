import { describe, expect, it } from 'vitest';
import { splitTopicIntoLessons, type PlannerTopic } from '../../src/planner/index.js';

function topic(over: Partial<PlannerTopic> = {}): PlannerTopic {
  return {
    key: 'a',
    topicId: 'a',
    name: 'Integrali',
    estimatedMinutes: 240,
    difficulty: 3,
    examWeight: 0.5,
    prerequisites: [],
    mastery: null,
    material: [{ docId: 'd1', pageFrom: 1, pageTo: 48 }],
    ...over,
  };
}

const pages = (l: { material: { pageFrom: number; pageTo: number }[] }) =>
  l.material.flatMap((m) =>
    Array.from({ length: m.pageTo - m.pageFrom + 1 }, (_, i) => m.pageFrom + i),
  );

describe('splitTopicIntoLessons', () => {
  it('splits by pages (12 per lesson by default), covering every page once, in order', () => {
    const lessons = splitTopicIntoLessons(topic());
    expect(lessons).toHaveLength(4);
    expect(lessons.flatMap(pages)).toEqual(Array.from({ length: 48 }, (_, i) => i + 1));
    expect(lessons.every((l) => l.title === 'Integrali')).toBe(true);
  });

  it('shares the estimate by pages, rounded to 5, and sprint is 60% of standard', () => {
    const lessons = splitTopicIntoLessons(topic());
    expect(lessons.map((l) => l.standardMinutes)).toEqual([60, 60, 60, 60]);
    expect(lessons.map((l) => l.sprintMinutes)).toEqual([35, 35, 35, 35]);
  });

  it('never goes below 30 standard minutes', () => {
    const lessons = splitTopicIntoLessons(topic({ estimatedMinutes: 40 }), { pagesPerLesson: 12 });
    expect(lessons.every((l) => l.standardMinutes === 30)).toBe(true);
    expect(lessons.every((l) => l.sprintMinutes === 20)).toBe(true);
  });

  it('a short topic is a single lesson with the whole material', () => {
    const t = topic({ material: [{ docId: 'd1', pageFrom: 5, pageTo: 10 }], estimatedMinutes: 90 });
    const lessons = splitTopicIntoLessons(t);
    expect(lessons).toEqual([
      { title: 'Integrali', material: t.material, standardMinutes: 90, sprintMinutes: 55 },
    ]);
  });

  it('honours pagesPerLesson and ranges across several documents', () => {
    const t = topic({
      material: [
        { docId: 'd1', pageFrom: 1, pageTo: 10 },
        { docId: 'd2', pageFrom: 3, pageTo: 12 },
      ],
    });
    const lessons = splitTopicIntoLessons(t, { pagesPerLesson: 8 });
    expect(lessons).toHaveLength(3);
    expect(lessons.flatMap((l) => l.material.map((m) => m.docId))).toEqual([
      'd1',
      'd1',
      'd2',
      'd2',
    ]);
    const all = lessons.flatMap((l) => l.material);
    expect(all.reduce((s, m) => s + m.pageTo - m.pageFrom + 1, 0)).toBe(20);
  });

  it('is deterministic', () => {
    expect(splitTopicIntoLessons(topic())).toEqual(splitTopicIntoLessons(topic()));
  });
});
