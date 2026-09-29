/**
 * Confidence calibration (docs/06-miglioramenti.md #4): before seeing the answer the user says how
 * sure they are (1 = non lo so, 2 = forse, 3 = lo so); afterwards the review says whether they were
 * right. The gap between the two is where they are *illuso di sapere* — the answers they were sure
 * about and got wrong — and, the other way round, where they know more than they think.
 *
 * Pure and deterministic. It is descriptive statistics on the user's own answers, and it refuses to
 * draw a conclusion from too few of them: a level with a handful of answers is noise, not a trait.
 */

export type Confidence = 1 | 2 | 3;

/** A review counts as "correct" when it wasn't a lapse: FSRS treats Hard as a pass, only Again fails. */
export function isCorrectRating(rating: number): boolean {
  return rating >= 2;
}

/** The accuracy a well-calibrated person would show at each level: midpoints of thirds. */
export const EXPECTED_ACCURACY: Record<Confidence, number> = { 1: 1 / 6, 2: 0.5, 3: 5 / 6 };

/** Below this many answers at a level, we report the numbers but draw no conclusion from them. */
export const MIN_SAMPLES_PER_LEVEL = 5;

export interface CalibrationSample {
  confidence: Confidence;
  correct: boolean;
  /** Optional grouping, e.g. a topic id, for `calibrationByGroup`. */
  group?: string | null;
}

export interface CalibrationLevel {
  confidence: Confidence;
  total: number;
  correct: number;
  /** correct / total; null when there is no answer at this level. */
  accuracy: number | null;
  /** Enough answers to say something about this level. */
  reliable: boolean;
}

export interface Calibration {
  total: number;
  levels: CalibrationLevel[];
  /**
   * Of the answers given at confidence 3, the share that was wrong — "ero sicuro e sbagliavo".
   * null while level 3 is not `reliable`.
   */
  illusionRate: number | null;
  /**
   * Of the answers given at confidence 1, the share that was right — "pensavo di non saperlo e lo
   * sapevo". null while level 1 is not `reliable`.
   */
  hiddenKnowledgeRate: number | null;
  /**
   * Mean expected accuracy minus actual accuracy over all answers: > 0 overconfident, < 0
   * underconfident, ~0 well calibrated. null until there are enough answers overall.
   */
  bias: number | null;
  verdict: 'overconfident' | 'underconfident' | 'calibrated' | 'insufficient_data';
}

/** |bias| under this is "calibrated": a few points either way is what luck alone produces. */
const CALIBRATED_BAND = 0.1;

export function computeCalibration(samples: CalibrationSample[]): Calibration {
  const levels: CalibrationLevel[] = ([1, 2, 3] as const).map((confidence) => {
    const at = samples.filter((s) => s.confidence === confidence);
    const correct = at.filter((s) => s.correct).length;
    return {
      confidence,
      total: at.length,
      correct,
      accuracy: at.length === 0 ? null : correct / at.length,
      reliable: at.length >= MIN_SAMPLES_PER_LEVEL,
    };
  });
  const [l1, , l3] = levels as [CalibrationLevel, CalibrationLevel, CalibrationLevel];

  const illusionRate = l3.reliable ? 1 - l3.correct / l3.total : null;
  const hiddenKnowledgeRate = l1.reliable ? l1.correct / l1.total : null;

  const enough = samples.length >= MIN_SAMPLES_PER_LEVEL * 2;
  let bias: number | null = null;
  if (enough) {
    const expected =
      samples.reduce((sum, s) => sum + EXPECTED_ACCURACY[s.confidence], 0) / samples.length;
    const actual = samples.filter((s) => s.correct).length / samples.length;
    bias = Math.round((expected - actual) * 1000) / 1000;
  }

  const verdict: Calibration['verdict'] =
    bias === null
      ? 'insufficient_data'
      : bias > CALIBRATED_BAND
        ? 'overconfident'
        : bias < -CALIBRATED_BAND
          ? 'underconfident'
          : 'calibrated';

  return { total: samples.length, levels, illusionRate, hiddenKnowledgeRate, bias, verdict };
}

export interface GroupIllusion {
  group: string;
  /** Answers given with confidence 3 in this group. */
  sure: number;
  /** Of those, how many were wrong. */
  sureButWrong: number;
  /** sureButWrong / sure. */
  illusionRate: number;
}

/**
 * Where the "illusion of knowing" concentrates: groups (topics) with enough confident answers,
 * ordered by how often confidence 3 was wrong. Groups with fewer than `minSure` confident answers
 * are left out rather than ranked on two data points.
 */
export function illusionByGroup(
  samples: CalibrationSample[],
  minSure = MIN_SAMPLES_PER_LEVEL,
): GroupIllusion[] {
  const acc = new Map<string, { sure: number; wrong: number }>();
  for (const s of samples) {
    if (s.confidence !== 3 || !s.group) continue;
    const g = acc.get(s.group) ?? { sure: 0, wrong: 0 };
    g.sure += 1;
    if (!s.correct) g.wrong += 1;
    acc.set(s.group, g);
  }
  return [...acc.entries()]
    .filter(([, g]) => g.sure >= minSure)
    .map(([group, g]) => ({
      group,
      sure: g.sure,
      sureButWrong: g.wrong,
      illusionRate: g.wrong / g.sure,
    }))
    .filter((g) => g.sureButWrong > 0)
    .sort(
      (a, b) =>
        b.illusionRate - a.illusionRate || b.sure - a.sure || a.group.localeCompare(b.group),
    );
}
