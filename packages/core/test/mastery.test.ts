import { describe, expect, it } from 'vitest';
import { computeMastery } from '../src/mastery.js';

describe('computeMastery', () => {
  it('applies the documented 0.5/0.3/0.2 weights when every component has data', () => {
    const result = computeMastery({ retrievability: 1, simulationAccuracy: 0, coverage: 0 });
    expect(result.value).toBeCloseTo(0.5, 6);
  });

  it('renormalizes over the components that have data instead of treating missing as zero', () => {
    // Only simulations: a perfect score means full mastery, not 0.3.
    expect(
      computeMastery({ retrievability: null, simulationAccuracy: 1, coverage: null }).value,
    ).toBe(1);
    // Cards + simulations (coverage untracked): weights become 0.625 / 0.375.
    const r = computeMastery({ retrievability: 0.8, simulationAccuracy: 0.4, coverage: null });
    expect(r.value).toBeCloseTo(0.625 * 0.8 + 0.375 * 0.4, 3);
  });

  it('is null when there is no data at all, with an explanation', () => {
    const r = computeMastery({ retrievability: null, simulationAccuracy: null, coverage: null });
    expect(r.value).toBeNull();
    expect(r.explanation).toMatch(/Nessun dato/);
  });

  it('clamps out-of-range inputs', () => {
    expect(
      computeMastery({ retrievability: 2, simulationAccuracy: -1, coverage: null }).value,
    ).toBeCloseTo(0.625, 3);
  });

  it('exposes the formula it actually applied (shown to the user, "niente numeri magici")', () => {
    const r = computeMastery({ retrievability: 0.5, simulationAccuracy: 0.5, coverage: null });
    expect(r.explanation).toContain('retrievability media card');
    expect(r.explanation).toContain('accuratezza simulazioni');
    expect(r.explanation).not.toContain('copertura');
  });
});
