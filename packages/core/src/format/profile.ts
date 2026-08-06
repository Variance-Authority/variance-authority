/**
 * Observation profiles.
 *
 * A profile declares what a collector was *capable* of observing, independent of
 * what it found. This distinction is load-bearing: see ADR-0002. Without it, a
 * JSDOM snapshot (no layout engine) compared against a Chromium baseline reports
 * either every rect as "moved to 0x0" or — far worse — reports a real geometry
 * regression as `unchanged`, because both sides omitted geometry.
 *
 * A false `unchanged` is the one failure mode this product must never produce.
 */


import type { Tier } from './tier.js';

/** Dimensions a collector may or may not be able to observe. */
export interface ObservationProfile {
  readonly id: ProfileId;

  /** Roles, accessible names, and ARIA states are resolvable. */
  readonly ariaTree: boolean;

  /** Author-declared style is readable (stylesheet rules, inline style). */
  readonly declaredStyle: boolean;

  /**
   * The cascade is fully resolved by a real engine, including relative units,
   * percentages, and inherited values that depend on layout.
   */
  readonly computedStyle: boolean;

  /** Real box geometry: positions and sizes from a layout engine. */
  readonly layout: boolean;

  /** Pixels can be produced. */
  readonly raster: boolean;
}

export type ProfileId = 'jsdom' | 'chromium';

/**
 * jest / vitest. Structure, ARIA, and declared style only.
 *
 * JSDOM has no layout engine: `getBoundingClientRect()` returns zeros and
 * `getComputedStyle()` resolves only what was declared. It is not a cheap
 * approximation of a browser — it is an earlier, different gate that decides
 * structural and token-band questions in milliseconds, in the unit-test process.
 */
export const JSDOM_PROFILE: ObservationProfile = {
  id: 'jsdom',
  ariaTree: true,
  declaredStyle: true,
  computedStyle: false,
  layout: false,
  raster: false,
};

/** playwright / agent-browser. Everything. */
export const CHROMIUM_PROFILE: ObservationProfile = {
  id: 'chromium',
  ariaTree: true,
  declaredStyle: true,
  computedStyle: true,
  layout: true,
  raster: true,
};

const PROFILES: Record<ProfileId, ObservationProfile> = {
  jsdom: JSDOM_PROFILE,
  chromium: CHROMIUM_PROFILE,
};

export function profileById(id: ProfileId): ObservationProfile {
  return PROFILES[id];
}

/**
 * The rung a collector with this profile actually stands on.
 *
 * Derived rather than declared, because a profile already says what it can
 * observe and a second field naming a tier is one more thing that can disagree
 * with the first. Used to charge a collection only for the stabilization tricks
 * it could see the effect of: jsdom has no layout engine and no animation clock,
 * so pinning animations and waiting for fonts there is a per-subject cost that
 * buys a rung that exists to be cheap exactly nothing.
 *
 * `raster` is never returned. Whether pixels *can* be produced is a property of
 * the machine, not of the reading being taken — and a collection is a reading,
 * so charging it for a caret it will never photograph would be the same mistake
 * in the other direction.
 */
export function tierOfProfile(profile: ObservationProfile): Tier {
  if (profile.layout || profile.computedStyle) return 'layout';
  if (profile.declaredStyle || profile.ariaTree) return 'semantic';
  return 'reachability';
}
