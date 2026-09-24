/** Splits on sentence-ending punctuation, trims, drops empties. Good enough for extraction — not NLP-grade. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

// Short Italian function words that carry no content for keyword matching.
const STOPWORDS = new Set([
  'della',
  'delle',
  'dello',
  'degli',
  'nella',
  'nelle',
  'nello',
  'negli',
  'sulla',
  'sulle',
  'questo',
  'questa',
  'questi',
  'queste',
  'quello',
  'quella',
  'quando',
  'perché',
  'mentre',
  'anche',
  'ancora',
  'sempre',
  'molto',
  'essere',
  'viene',
  'vengono',
  'hanno',
  'secondo',
  'attraverso',
  'ovvero',
  'quindi',
  'infatti',
  'tramite',
  'ciascun',
  'ciascuna',
  'ogni',
]);

/** Accent-folded lowercase content words (≥5 chars, no stopwords). Deterministic, not NLP-grade. */
export function keywords(text: string): string[] {
  const folded = text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const words = folded.match(/[a-z0-9]+/g) ?? [];
  return [...new Set(words.filter((w) => w.length >= 5 && !STOPWORDS.has(w)))];
}

/** Fraction of `reference`'s keywords present in `candidate` (1 when `reference` has none). */
export function keywordCoverage(reference: string, candidate: string): number {
  const ref = keywords(reference);
  if (ref.length === 0) return 1;
  const cand = new Set(keywords(candidate));
  return ref.filter((w) => cand.has(w)).length / ref.length;
}
