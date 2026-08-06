/**
 * The cheapest representation that can answer a question.
 *
 * Ordered, and the order is the cost. Everything in this project that says "do
 * not pay for what this rung cannot observe" says it with this type: a tool
 * declares the rung it needs and a plan running lower is told which of its tools
 * cannot do their job; a stabilization trick declares the rung that can observe
 * what it fixes, so the structure-and-style rung waits for no fonts.
 *
 * It lives in `format` rather than in `plan` because two different groups need
 * it and `format` is the one both may depend on. It was in `plan` until
 * 2026-08-06, when the stabilization vocabulary moved into `format` and brought
 * a second, separately-declared four-value union with it — two copies of a
 * ladder that must not drift.
 */
export type Tier = 'reachability' | 'semantic' | 'layout' | 'raster';

const TIER_ORDER: Record<Tier, number> = {
  reachability: 0,
  semantic: 1,
  layout: 2,
  raster: 3,
};

/** Position on the ladder. Higher is more expensive and observes more. */
export function tierRank(tier: Tier): number {
  return TIER_ORDER[tier];
}

/** Whether a rung can observe what something declaring `needs` requires. */
export function tierReaches(available: Tier, needs: Tier): boolean {
  return TIER_ORDER[needs] <= TIER_ORDER[available];
}
