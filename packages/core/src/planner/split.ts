import type { MaterialRef, PlannerLesson, PlannerTopic } from './types.js';

const DEFAULT_PAGES_PER_LESSON = 12;
const MIN_LESSON_MINUTES = 30;
const SPRINT_RATIO = 0.6;

function round5(n: number): number {
  return Math.round(n / 5) * 5;
}

/**
 * Pages [startPage, endPage) of the concatenated material ranges (0-based), mapped back to real
 * page numbers. Consecutive slices share no page by construction.
 */
export function sliceMaterial(
  material: MaterialRef[],
  startPage: number,
  endPage: number,
): MaterialRef[] {
  const out: MaterialRef[] = [];
  let offset = 0;
  for (const m of material) {
    const len = m.pageTo - m.pageFrom + 1;
    const lo = Math.max(startPage, offset);
    const hi = Math.min(endPage, offset + len);
    if (hi > lo)
      out.push({
        docId: m.docId,
        pageFrom: m.pageFrom + (lo - offset),
        pageTo: m.pageFrom + (hi - offset) - 1,
      });
    offset += len;
  }
  return out;
}

/**
 * Splits a topic into lessons by page ranges of its material — by content, never by minutes — for
 * estimates that have no AI lessons. Standard minutes are the topic estimate shared out by pages
 * (rounded to 5, at least 30); sprint is 60% of standard. Pure and deterministic.
 */
export function splitTopicIntoLessons(
  topic: PlannerTopic,
  opts: { pagesPerLesson?: number } = {},
): PlannerLesson[] {
  const perLesson = Math.max(1, Math.floor(opts.pagesPerLesson ?? DEFAULT_PAGES_PER_LESSON));
  const total = topic.material.reduce((s, m) => s + (m.pageTo - m.pageFrom + 1), 0);
  const count = Math.max(1, Math.ceil(total / perLesson));
  const lesson = (material: MaterialRef[], share: number): PlannerLesson => {
    const standardMinutes = Math.max(MIN_LESSON_MINUTES, round5(topic.estimatedMinutes * share));
    return {
      title: topic.name,
      material,
      standardMinutes,
      sprintMinutes: round5(SPRINT_RATIO * standardMinutes),
    };
  };
  if (total <= 0 || count === 1) return [lesson(topic.material, 1)];
  return Array.from({ length: count }, (_, i) => {
    // Even split of the pages: the first and the last lesson differ by at most one page.
    const from = Math.floor((i * total) / count);
    const to = Math.floor(((i + 1) * total) / count);
    return lesson(sliceMaterial(topic.material, from, to), (to - from) / total);
  });
}
