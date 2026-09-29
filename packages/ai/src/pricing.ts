/**
 * Approximate per-model pricing, USD per million tokens, converted to EUR at
 * a fixed illustrative rate. These are **placeholders** — real prices change
 * and depend on your actual Anthropic plan; update `MODEL_PRICING` (or read
 * it from `settings` in a later phase) before trusting the numbers this
 * produces for real budgeting. Good enough today for: ordering estimates
 * relative to each other, and exercising the budget-guard code path.
 */
const USD_TO_EUR = 0.92;

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-haiku-4-5-20251001': { inputPerMillion: 1, outputPerMillion: 5 },
  'claude-sonnet-5-5': { inputPerMillion: 3, outputPerMillion: 15 },
  'claude-opus-5-5': { inputPerMillion: 15, outputPerMillion: 75 },
  // Legacy ids: data generated before the 5.5 upgrade still carries these model names.
  'claude-sonnet-5': { inputPerMillion: 3, outputPerMillion: 15 },
  'claude-opus-5': { inputPerMillion: 15, outputPerMillion: 75 },
  // The fake provider does no real inference; kept at 0 so dry runs/tests
  // never report a nonzero simulated cost.
  'fake-v1': { inputPerMillion: 0, outputPerMillion: 0 },
};

const DEFAULT_PRICING: ModelPricing = { inputPerMillion: 3, outputPerMillion: 15 };

export function estimateCostEur(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model] ?? DEFAULT_PRICING;
  const usd =
    (inputTokens / 1_000_000) * pricing.inputPerMillion +
    (outputTokens / 1_000_000) * pricing.outputPerMillion;
  return Math.round(usd * USD_TO_EUR * 1_000_000) / 1_000_000;
}

/** ~4 chars/token, the same rough heuristic used elsewhere in this codebase (apps/worker). */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
