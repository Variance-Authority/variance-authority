import { describe, expect, it } from 'vitest';
import { LAYOUT_RECIPE, validatePlan, planForTier } from '@variance-authority/core';
import { DEFAULT_PLAN, defaultPlan, defaultPlanIdentity } from './plan.js';

/**
 * The shipped composition, checked for the property that makes declaring it
 * worthwhile: that changing what the system *is* changes how it addresses what
 * it produced.
 */

describe('the shipped plan', () => {
  it('is well formed at the tier it was built for', () => {
    expect(validatePlan(DEFAULT_PLAN, 'raster')).toEqual([]);
  });

  it('degrades to the tools a semantic run can actually use', () => {
    // Not an error — this is the cheap gate, and it is a legitimate composition.
    expect(planForTier(DEFAULT_PLAN, 'semantic').map((tool) => tool.kind)).toEqual([
      'acquire',
      'map',
      'judge',
    ]);
  });
});

describe('changing the system changes the address', () => {
  it('moves when the comparison policy is retuned', () => {
    // A threshold is a decision about what counts as a difference. Two runs
    // under different thresholds are not comparable, and a machine-and-fonts
    // identity is blind to it.
    expect(
      defaultPlanIdentity({ policy: { id: 'strict', threshold: 0, includeAA: true } }),
    ).not.toBe(defaultPlanIdentity());
  });

  it('moves when the clustering granularity changes', () => {
    expect(defaultPlanIdentity({ cell: 16 })).not.toBe(defaultPlanIdentity());
  });

  it('moves when the tricks applied to the page change', () => {
    expect(defaultPlanIdentity({ stabilization: LAYOUT_RECIPE })).not.toBe(defaultPlanIdentity());
  });

  it('holds for an unchanged composition', () => {
    expect(defaultPlanIdentity()).toBe(defaultPlanIdentity());
    expect(defaultPlan()).toEqual(DEFAULT_PLAN);
  });
});
