/**
 * Which chunks of a study session the briefing model sees (docs/08-sessione-di-studio.md §5.2).
 * Pure — the caller loads the chunks and the task's planned pages, this only decides what fits.
 */
export const BRIEFING_KEY_POINTS = 6;
export const BRIEFING_EXERCISES = 4;
/** "Altri esercizi". */
export const BRIEFING_MORE_EXERCISES = 3;
/** Roughly 12k tokens of material: enough for a session, cheap enough to run on request. */
export const BRIEFING_MAX_CHARS = 48_000;

export interface BriefingChunk {
  docId: string;
  page: number;
  text: string;
}

export interface PlannedPages {
  docId: string;
  pageFrom: number;
  pageTo: number;
}

/**
 * Chunks on the pages the task planned come first, then the rest, until `maxChars` is reached (the
 * first chunk is always kept so a single huge page still produces a briefing). The selection is
 * returned in the original order, so the model reads the material as the student does.
 */
export function selectBriefingChunks(
  chunks: BriefingChunk[],
  planned: PlannedPages[],
  maxChars: number = BRIEFING_MAX_CHARS,
): BriefingChunk[] {
  const isPlanned = (c: BriefingChunk) =>
    planned.some((p) => p.docId === c.docId && c.page >= p.pageFrom && c.page <= p.pageTo);
  const ranked = [...chunks.filter(isPlanned), ...chunks.filter((c) => !isPlanned(c))];

  const chosen = new Set<BriefingChunk>();
  let used = 0;
  for (const chunk of ranked) {
    if (chosen.size > 0 && used + chunk.text.length > maxChars) continue;
    chosen.add(chunk);
    used += chunk.text.length;
  }
  return chunks.filter((c) => chosen.has(c));
}

/** One line on how the course's exams are written, for the exercises' style. */
export function describeExamStyle(profile: {
  kindDistribution: Record<string, number>;
  verbosity: string;
  notes: string;
}): string {
  const kinds = Object.entries(profile.kindDistribution)
    .filter(([, weight]) => weight > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([kind, weight]) => `${kind} ${Math.round(weight * 100)}%`)
    .join(', ');
  const parts = [
    kinds ? `tipologie ${kinds}` : '',
    `risposte ${profile.verbosity}`,
    profile.notes.trim(),
  ].filter(Boolean);
  return parts.join('; ');
}
