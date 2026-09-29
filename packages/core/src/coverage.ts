/**
 * Gap analysis / coverage map (docs/06-miglioramenti.md #2): cross the subject's topics with the
 * material owned, the flashcards that exist, and how often the topic shows up in past exams — to
 * answer "non hai materiale su X, che compare in 4 esami su 5" before the user studies the wrong
 * thing. Pure and deterministic: no AI, so it is free, instant and testable.
 *
 * Matching is by text, not by embeddings: a topic "appears" in an exam when its words do. That is
 * a heuristic and is stated as one — it under-counts a topic the exam names differently, and it
 * can over-count a very generic topic name. The counts it produces are evidence to look at, not a
 * verdict.
 */

/** Lowercase, strip accents and punctuation, collapse whitespace. */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const MIN_TOKEN = 4; // shorter words ("di", "e", "la", "ed") say nothing about a topic

/** The words that identify a topic: the ≥4-letter ones, cut back a little so plurals/genders match. */
function stems(name: string): string[] {
  return normalizeText(name)
    .split(' ')
    .filter((w) => w.length >= MIN_TOKEN)
    .map((w) => w.slice(0, Math.max(MIN_TOKEN, w.length - 2))); // trasformata / trasformate -> trasform
}

/**
 * True when every identifying word of `name` occurs (as a word prefix) in `text`. A name with no
 * identifying word (e.g. "AI") falls back to the whole normalized name as a word.
 */
export function mentionsTopic(text: string, name: string): boolean {
  const haystack = ` ${normalizeText(text)} `;
  const needed = stems(name);
  if (needed.length === 0) {
    const whole = normalizeText(name);
    return whole.length > 0 && haystack.includes(` ${whole} `);
  }
  return needed.every((stem) => haystack.includes(` ${stem}`));
}

export type GapFlag = 'no_material' | 'no_cards' | 'weak';

export interface CoverageTopicInput {
  id: string;
  name: string;
  mastery: number | null;
  /** Non-exam documents linked to the topic, and their total pages. */
  materialDocs: number;
  materialPages: number;
  cards: number;
}

export interface CoverageInput {
  topics: CoverageTopicInput[];
  /** One entry per past exam: its full text. */
  examTexts: string[];
  /** One entry per study document (not exams): its full text — to spot unmapped exam themes. */
  materialTexts: string[];
  /** `ExamProfile.recurringTopics` — themes the profile extraction flagged as recurring. */
  recurringTopics: string[];
}

export interface CoverageTopic {
  topicId: string;
  name: string;
  /** How many past exams mention it, out of `examTotal`. */
  examMentions: number;
  examTotal: number;
  /** Also listed in the exam profile's recurring topics. */
  recurring: boolean;
  materialDocs: number;
  materialPages: number;
  cards: number;
  mastery: number | null;
  flags: GapFlag[];
  /** 0 when there is no gap; higher = more urgent. Only for ordering. */
  priority: number;
}

/** A theme the exams keep raising that matches no topic of the subject at all. */
export interface UnmappedExamTopic {
  name: string;
  /** Study documents whose text mentions it — 0 means the material doesn't cover it either. */
  materialMentions: number;
}

export interface CoverageMap {
  examTotal: number;
  topics: CoverageTopic[];
  unmapped: UnmappedExamTopic[];
}

const WEAK_MASTERY = 0.5;
/** Severity of each gap: no material is the costliest — you can't even study it. */
const SEVERITY: Record<GapFlag, number> = { no_material: 3, no_cards: 2, weak: 1 };
/** Weight of a topic no exam mentions: it may still matter, but less than one they keep asking. */
const NO_EVIDENCE_WEIGHT = 0.25;

export function computeCoverageMap(input: CoverageInput): CoverageMap {
  const examTotal = input.examTexts.length;

  const topics: CoverageTopic[] = input.topics.map((t) => {
    const examMentions = input.examTexts.filter((text) => mentionsTopic(text, t.name)).length;
    const recurring = input.recurringTopics.some(
      (r) => mentionsTopic(r, t.name) || mentionsTopic(t.name, r),
    );

    const flags: GapFlag[] = [];
    if (t.materialDocs === 0) flags.push('no_material');
    if (t.cards === 0) flags.push('no_cards');
    if (t.mastery !== null && t.mastery < WEAK_MASTERY) flags.push('weak');

    const weight =
      examMentions > 0
        ? examMentions / examTotal
        : recurring
          ? 1 // the profile says it recurs even if no single exam text names it verbatim
          : NO_EVIDENCE_WEIGHT;
    const severity = flags.reduce((sum, f) => sum + SEVERITY[f], 0);

    return {
      topicId: t.id,
      name: t.name,
      examMentions,
      examTotal,
      recurring,
      materialDocs: t.materialDocs,
      materialPages: t.materialPages,
      cards: t.cards,
      mastery: t.mastery,
      flags,
      priority: Math.round(weight * severity * 1000) / 1000,
    };
  });
  topics.sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));

  const unmapped: UnmappedExamTopic[] = [];
  for (const raw of input.recurringTopics) {
    const name = raw.trim();
    if (!name) continue;
    const covered = input.topics.some(
      (t) => mentionsTopic(name, t.name) || mentionsTopic(t.name, name),
    );
    if (covered || unmapped.some((u) => normalizeText(u.name) === normalizeText(name))) continue;
    unmapped.push({
      name,
      materialMentions: input.materialTexts.filter((text) => mentionsTopic(text, name)).length,
    });
  }
  // No material at all first: that is the gap that hurts most.
  unmapped.sort((a, b) => a.materialMentions - b.materialMentions || a.name.localeCompare(b.name));

  return { examTotal, topics, unmapped };
}

/** The one-line, human statement of a topic's gap ("Non hai materiale su X, che compare in 4 esami su 5."). */
export function describeGap(t: CoverageTopic): string | null {
  if (t.flags.length === 0) return null;
  const frequency =
    t.examTotal > 0 && t.examMentions > 0
      ? `, che compare in ${t.examMentions} ${t.examMentions === 1 ? 'esame' : 'esami'} su ${t.examTotal}`
      : t.recurring
        ? ", che il profilo d'esame indica come ricorrente"
        : '';
  const parts: string[] = [];
  if (t.flags.includes('no_material')) parts.push(`Non hai materiale su "${t.name}"`);
  if (t.flags.includes('no_cards'))
    parts.push(parts.length === 0 ? `Non hai flashcard su "${t.name}"` : 'e nessuna flashcard');
  if (t.flags.includes('weak'))
    parts.push(
      parts.length === 0
        ? `"${t.name}" è ancora debole (${Math.round((t.mastery ?? 0) * 100)}%)`
        : `ed è debole (${Math.round((t.mastery ?? 0) * 100)}%)`,
    );
  const [first, ...rest] = parts;
  return `${[first, ...rest].join(' ')}${frequency}.`;
}
