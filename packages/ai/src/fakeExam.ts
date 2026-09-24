import type {
  ChunkRef,
  ExamProfilePromptInput,
  GradePromptInput,
  SimulationPromptInput,
} from './provider.js';
import type {
  ExamProfile,
  GradeOutput,
  RubricCriterion,
  SimulationItem,
  SimulationItemKind,
  SimulationOutput,
} from './schemas.js';
import { keywordCoverage, keywords, splitSentences, truncate } from './text.js';

/**
 * Deterministic heuristics behind `FakeProvider`'s F5 capabilities. Like the
 * flashcard fake, these do real (if crude) work on the actual text — they
 * are not canned responses — so the worker, the exam-mode UI and the
 * grading pipeline are exercised against plausible, schema-valid data.
 * None of this approximates a real model's judgment.
 */

const DEFAULT_TOTAL_POINTS = 30; // Italian university grading is out of 30.

const EXAM_BOILERPLATE = new Set([
  'esercizio',
  'domanda',
  'quesito',
  'problema',
  'punti',
  'punto',
  'tempo',
  'disposizione',
  'minuti',
  'calcolare',
  'dimostrare',
  'definire',
  'enunciare',
  'determinare',
  'spiegare',
  'descrivere',
  'illustrare',
  'discutere',
  'motivare',
  'risposta',
  'seguenti',
]);

const EXERCISE_MARKER = /(?=\b(?:esercizio|domanda|quesito|problema)\s*\d+)/i;

/**
 * Splits a past exam into its exercises. Prefers explicit "Esercizio N"
 * markers (each segment keeps its full body, so "Esercizio 2. Calcolare…"
 * classifies as numeric); falls back to question-like sentences.
 */
export function extractExercises(text: string): string[] {
  const segments = text.split(EXERCISE_MARKER).map((s) => s.trim());
  const marked = segments.filter((s) => /^(esercizio|domanda|quesito|problema)\s*\d+/i.test(s));
  if (marked.length > 0) return marked;
  return splitSentences(text).filter((s) => s.endsWith('?') || /^\d+\s*[.)]\s/.test(s));
}

export function classifyKind(text: string): SimulationItemKind {
  if (/dimostr|si provi che|provare che/i.test(text)) return 'proof';
  if (/quale delle seguenti|\b[a-d]\)\s/i.test(text)) return 'mcq';
  if (/calcol|determin|quanto vale|valore numerico/i.test(text)) return 'numeric';
  return 'open';
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function fakeExtractExamProfile(input: ExamProfilePromptInput): ExamProfile {
  const byDoc = new Map<string, string[]>();
  for (const chunk of input.chunks) {
    const items = extractExercises(chunk.text);
    byDoc.set(chunk.docId, [...(byDoc.get(chunk.docId) ?? []), ...items]);
  }
  const docCount = Math.max(1, byDoc.size);
  const allItems = [...byDoc.values()].flat();
  const allText = input.chunks.map((c) => c.text).join('\n');

  const itemCount = Math.max(1, Math.round(allItems.length / docCount));

  const pointsMatches = [...allText.matchAll(/(\d+)\s*punt[io]/gi)].map((m) => Number(m[1]));
  const totalPoints =
    pointsMatches.length > 0
      ? Math.max(1, Math.round(pointsMatches.reduce((a, b) => a + b, 0) / docCount))
      : DEFAULT_TOTAL_POINTS;

  const minutes = allText.match(/(\d+)\s*(minuti|min)\b/i);
  const hours = allText.match(/(\d+(?:[.,]\d+)?)\s*ore\b/i);
  const durationMin = minutes
    ? Number(minutes[1])
    : hours
      ? Math.round(Number(hours[1]!.replace(',', '.')) * 60)
      : itemCount * 20;

  const kinds: SimulationItemKind[] = ['open', 'mcq', 'numeric', 'proof'];
  const counts = Object.fromEntries(kinds.map((k) => [k, 0])) as Record<SimulationItemKind, number>;
  for (const item of allItems) counts[classifyKind(item)] += 1;
  const totalClassified = Math.max(1, allItems.length);
  const kindDistribution = Object.fromEntries(
    kinds.map((k) => [
      k,
      allItems.length === 0 ? (k === 'open' ? 1 : 0) : round1(counts[k] / totalClassified),
    ]),
  ) as Record<SimulationItemKind, number>;

  const avgLength =
    allItems.length === 0 ? 0 : allItems.reduce((s, i) => s + i.length, 0) / allItems.length;
  const verbosity: ExamProfile['verbosity'] =
    avgLength < 80 ? 'breve' : avgLength < 200 ? 'media' : 'estesa';

  // Recurring = keywords appearing in the exercises of at least two different past exams,
  // minus exam boilerplate ("Esercizio", "10 punti", "Calcolare"…) that isn't a topic.
  const docsPerKeyword = new Map<string, Set<string>>();
  for (const [docId, items] of byDoc) {
    for (const word of keywords(items.join(' ')).filter((w) => !EXAM_BOILERPLATE.has(w))) {
      docsPerKeyword.set(word, (docsPerKeyword.get(word) ?? new Set()).add(docId));
    }
  }
  const recurringTopics = [...docsPerKeyword.entries()]
    .filter(([, docs]) => docs.size >= Math.min(2, docCount))
    .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([word]) => word);

  return {
    itemCount,
    durationMin: Math.max(1, durationMin),
    totalPoints,
    kindDistribution,
    avgMinutesPerItem: Math.max(1, round1(Math.max(1, durationMin) / itemCount)),
    verbosity,
    recurringTopics,
    notes: `Profilo stimato per estrazione euristica da ${byDoc.size} documento/i e ${allItems.length} esercizi riconosciuti (provider simulato, non un modello reale).`,
  };
}

/** Largest-remainder allocation of `n` items over the profile's kind distribution — deterministic. */
export function allocateKinds(
  distribution: Partial<Record<SimulationItemKind, number>>,
  n: number,
): SimulationItemKind[] {
  const weight = (k: SimulationItemKind) => distribution[k] ?? 0;
  const kinds = (['open', 'mcq', 'numeric', 'proof'] as const).filter((k) => weight(k) > 0);
  if (kinds.length === 0) return Array.from({ length: n }, () => 'open');
  const total = kinds.reduce((s, k) => s + weight(k), 0);
  const exact = kinds.map((k) => ({ k, v: (weight(k) / total) * n }));
  const base = exact.map((e) => ({ k: e.k, count: Math.floor(e.v), rem: e.v - Math.floor(e.v) }));
  let assigned = base.reduce((s, b) => s + b.count, 0);
  for (const b of [...base].sort((a, c) => c.rem - a.rem || a.k.localeCompare(c.k))) {
    if (assigned >= n) break;
    b.count += 1;
    assigned += 1;
  }
  return base.flatMap((b) => Array.from({ length: b.count }, () => b.k));
}

/** Splits `total` into `parts` shares rounded to 0.5, fixing the last so they sum exactly. */
export function splitPoints(total: number, parts: number): number[] {
  const share = Math.round((total / parts) * 2) / 2;
  const result = Array.from({ length: parts }, () => share);
  const sumButLast = share * (parts - 1);
  result[parts - 1] = Math.round((total - sumButLast) * 100) / 100;
  if (result[parts - 1]! <= 0) {
    // Degenerate rounding (tiny totals): fall back to exact equal shares.
    return Array.from({ length: parts }, () => total / parts);
  }
  return result;
}

function clauses(sentence: string): string[] {
  const parts = sentence
    .replace(/[.!?]$/, '')
    .split(/[,;:]|\s+e\s+|\s+ma\s+/)
    .map((p) => p.trim())
    .filter((p) => p.split(/\s+/).length >= 3);
  return (parts.length > 0 ? parts : [sentence]).slice(0, 3);
}

const PROMPT_TEMPLATES: Record<SimulationItemKind, (s: string) => string> = {
  open: (s) =>
    `Illustra il seguente concetto, collegandolo al resto del programma: «${truncate(s, 140)}»`,
  proof: (s) =>
    `Giustifica formalmente, passaggio per passaggio, la seguente affermazione: «${truncate(s, 140)}»`,
  numeric: (s) =>
    `Imposta un esempio numerico che applichi quanto segue e risolvilo: «${truncate(s, 140)}»`,
  mcq: (s) => `Vero o falso? Motiva la risposta: «${truncate(s, 140)}»`,
};

export function fakeGenerateSimulation(input: SimulationPromptInput): SimulationOutput {
  const candidates: { chunk: ChunkRef; sentence: string }[] = [];
  for (const chunk of input.chunks) {
    for (const sentence of splitSentences(chunk.text)) {
      if (sentence.length >= 30) candidates.push({ chunk, sentence });
    }
  }
  if (candidates.length === 0) {
    throw new Error(
      'materiale insufficiente per generare una simulazione (servono frasi di almeno 30 caratteri)',
    );
  }

  let pool = candidates;
  if (input.mode === 'drill_argomento' && input.topicName) {
    const topicWords = keywords(input.topicName);
    const onTopic = candidates.filter((c) =>
      topicWords.some((w) => keywords(c.sentence).includes(w)),
    );
    if (onTopic.length > 0) pool = onTopic;
  }
  // Drill: "N esercizi crescenti" — longer sentences stand in for harder items.
  if (input.mode === 'drill_argomento') {
    pool = [...pool].sort((a, b) => a.sentence.length - b.sentence.length);
  }

  const itemCount = Math.max(1, input.itemCount);
  const kinds =
    input.mode === 'drill_argomento'
      ? Array.from({ length: itemCount }, () => 'open' as SimulationItemKind)
      : allocateKinds(input.profile.kindDistribution, itemCount);
  const totalPoints =
    input.mode === 'esame_completo'
      ? (input.profile.totalPoints * itemCount) / Math.max(1, input.profile.itemCount)
      : itemCount * 10;
  const itemPoints = splitPoints(Math.round(totalPoints * 10) / 10, itemCount);

  const items: SimulationItem[] = kinds.map((kind, i) => {
    const { chunk, sentence } = pool[i % pool.length]!;
    const expected = clauses(sentence);
    const points = itemPoints[i]!;
    const criterionPoints = splitPoints(points, expected.length);
    const rubric: RubricCriterion[] = expected.map((e, j) => ({
      criterion: `Tratta: ${truncate(e, 80)}`,
      points: criterionPoints[j]!,
    }));
    return {
      prompt: PROMPT_TEMPLATES[kind](sentence),
      kind,
      points,
      expectedPoints: expected,
      rubric,
      solution: sentence,
      sourceRef: { docId: chunk.docId, page: chunk.page, quote: sentence },
    };
  });

  const timeBudgetMin =
    input.mode === 'esame_completo'
      ? Math.max(
          1,
          Math.round(
            (input.profile.durationMin * itemCount) / Math.max(1, input.profile.itemCount),
          ),
        )
      : Math.max(1, Math.round(itemCount * input.profile.avgMinutesPerItem));

  return { items, timeBudgetMin };
}

/**
 * Keyword-coverage grading, per rubric criterion. Awards points in half-point
 * steps proportional to how many of the criterion's content words appear in
 * the answer. Crude, but monotonic (a more complete answer never scores
 * lower) and never exceeds the criterion's max — the invariants the worker
 * and UI rely on.
 */
export function fakeGradeAnswer(input: GradePromptInput): GradeOutput {
  const answer = input.answer.trim();
  const criteria = input.item.rubric.map((r, i) => {
    const reference = input.item.expectedPoints[i] ?? r.criterion;
    const coverage = answer.length === 0 ? 0 : keywordCoverage(reference, answer);
    const awarded = Math.min(r.points, Math.round(r.points * coverage * 2) / 2);
    const feedback =
      coverage >= 0.999
        ? 'Criterio soddisfatto.'
        : coverage === 0
          ? `Non trattato: manca «${truncate(reference, 80)}».`
          : `Parziale: la risposta tocca il punto ma è incompleta rispetto a «${truncate(reference, 80)}».`;
    return { criterion: r.criterion, awarded, max: r.points, feedback };
  });
  const missing = input.item.expectedPoints.filter(
    (e) => answer.length === 0 || keywordCoverage(e, answer) < 0.5,
  );
  return { criteria, missing };
}
