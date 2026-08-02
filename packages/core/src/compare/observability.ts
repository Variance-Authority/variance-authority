/**
 * What a profile can decide, band by band.
 *
 * This lives in `compare` rather than beside `ObservationProfile` in `format`
 * because it is a statement about *bands*, and a band classifies a delta. Core's
 * entrypoints run format → rules → compare → attribute → judge → plan, and a
 * `format` module importing `Band` would point that arrow backwards. The profile
 * describes a collector's capability; mapping that capability onto what can be
 * settled is the comparison layer's question.
 */

import type { ObservationProfile } from '../format/profile.js';
import type { Band } from './band.js';

/** How completely a profile can decide one band. */
export type Observability = 'full' | 'structural-only' | 'declared-only' | 'none';

/**
 * Bands a profile is able to decide. A band this returns `none` for can never
 * resolve to `unchanged` under that profile — it resolves to `unobserved`.
 *
 * JSDOM sees structural geometry (nodes appearing, disappearing, reordering)
 * because that is tree shape, but not metric geometry (moves, resizes) because
 * that requires an engine. `geometry` is therefore only partially observable,
 * and partial observation of a blocking band is reported, never assumed away.
 *
 * The two bands that need no engine are worth stating rather than leaving to be
 * inferred: **`a11y` and `content` are fully decidable in the unit-test
 * process.** A role, an accessible name, an ARIA state and a text node are facts
 * about a document, so a dropped `aria-label` and a changed string are settled at
 * the cheapest tier this project has — no browser, no screenshot, no baseline
 * image. That is the concrete form of `docs/comparison.md` §3.3: the category no
 * raster comparison can reach is also the category that costs least to reach.
 *
 * The return type is `Record<Band, …>` on purpose. Declaring a new band and
 * forgetting to say whether a profile can observe it is a compile error, not a
 * silent `undefined` that a truthiness check reads as "no".
 */
export function observableBands(profile: ObservationProfile): Record<Band, Observability> {
  return {
    a11y: profile.ariaTree ? 'full' : 'none',
    geometry: profile.layout ? 'full' : profile.ariaTree ? 'structural-only' : 'none',
    token: profile.computedStyle ? 'full' : profile.declaredStyle ? 'declared-only' : 'none',
    // Text is the one band no collector can fail at: having a document is the
    // precondition for producing a snapshot at all.
    content: 'full',
    texture: profile.raster ? 'full' : 'none',
  };
}

/**
 * Whether a level is enough to settle its band, or whether the band must be
 * reported `unobserved`.
 *
 * The asymmetry between `geometry` and everything else is ADR-0002 and is
 * deliberate. `structural-only` geometry is *not* enough: a profile that sees
 * tree shape but not metrics would report a box that moved as `unchanged`, which
 * is the one failure this product must never produce. `declared-only` style *is*
 * enough — an author's declaration is a real answer about the token band, just a
 * narrower one than a resolved cascade.
 */
export function decidesBand(band: Band, level: Observability): boolean {
  return band === 'geometry' ? level === 'full' : level !== 'none';
}
