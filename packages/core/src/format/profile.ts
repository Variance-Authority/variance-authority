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
 * Bands a profile is able to decide. A band absent from this set can never
 * resolve to `unchanged` under that profile — it resolves to `unobserved`.
 *
 * JSDOM sees structural geometry (nodes appearing, disappearing, reordering)
 * because that is tree shape, but not metric geometry (moves, resizes) because
 * that requires an engine. `geometry` is therefore only partially observable,
 * and partial observation of a blocking band is reported, never assumed away.
 */
export function observableBands(profile: ObservationProfile): {
  geometry: 'full' | 'structural-only' | 'none';
  token: 'full' | 'declared-only' | 'none';
  texture: 'full' | 'none';
} {
  return {
    geometry: profile.layout ? 'full' : profile.ariaTree ? 'structural-only' : 'none',
    token: profile.computedStyle ? 'full' : profile.declaredStyle ? 'declared-only' : 'none',
    texture: profile.raster ? 'full' : 'none',
  };
}
