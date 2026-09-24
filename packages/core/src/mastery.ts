/**
 * mastery(topic) = 0.5·retrievability_media_card + 0.3·accuratezza_simulazioni + 0.2·copertura_materiale_letto
 * (docs/02-filesystem-e-dati.md §5 — "formula esplicitata e mostrata all'utente: niente numeri magici").
 *
 * A component with no data yet (no reviewed cards, no simulation on the
 * topic, no material assigned to the topic) is *absent*, not zero: its
 * weight is dropped and the remaining weights are renormalized. Otherwise a
 * topic with perfect simulations but no flashcards would be capped at 0.3 —
 * punishing the user for a feature they didn't use. Coverage (fraction of
 * the topic's assigned material actually read) is computed in
 * `packages/db/src/mastery.ts::recomputeTopicMastery` from `done` `read`
 * tasks — absent only for a topic with no material tagged to it at all.
 */
export const MASTERY_WEIGHTS = {
  retrievability: 0.5,
  simulationAccuracy: 0.3,
  coverage: 0.2,
} as const;

export interface MasteryInputs {
  retrievability: number | null;
  simulationAccuracy: number | null;
  coverage: number | null;
}

export interface MasteryResult {
  /** 0..1, or null when no component has data. */
  value: number | null;
  /** The formula actually applied, with the renormalized weights — for the UI tooltip. */
  explanation: string;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export function computeMastery(inputs: MasteryInputs): MasteryResult {
  const parts = (Object.keys(MASTERY_WEIGHTS) as (keyof MasteryInputs)[])
    .filter((k) => inputs[k] !== null)
    .map((k) => ({ key: k, weight: MASTERY_WEIGHTS[k], value: clamp01(inputs[k] as number) }));

  if (parts.length === 0) {
    return {
      value: null,
      explanation: 'Nessun dato: né card ripassate, né simulazioni su questo argomento.',
    };
  }

  const totalWeight = parts.reduce((s, p) => s + p.weight, 0);
  const value = parts.reduce((s, p) => s + (p.weight / totalWeight) * p.value, 0);
  const labels: Record<keyof MasteryInputs, string> = {
    retrievability: 'retrievability media card',
    simulationAccuracy: 'accuratezza simulazioni',
    coverage: 'copertura materiale',
  };
  const explanation = parts
    .map((p) => `${(p.weight / totalWeight).toFixed(2)}·${labels[p.key]} (${p.value.toFixed(2)})`)
    .join(' + ');

  return {
    value: Math.round(value * 1000) / 1000,
    explanation: `${explanation} = ${value.toFixed(2)}`,
  };
}
