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
import { BANDS, type Band } from './band.js';

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

/**
 * How completely a band was decided when two profiles both had to decide it.
 *
 * The weaker reading wins, which is the same union rule `unobserved` is built
 * from carried one value further. A pair is only as well observed as its blinder
 * side, and reporting the better side's level would describe a reading nobody
 * took.
 *
 * The two partial levels never meet: `structural-only` is a geometry answer and
 * `declared-only` a token one, and a band produces at most one of them. So the
 * ranking needs no tie-break between them, and a tie is two spellings of one
 * level.
 */
const RANK: Readonly<Record<Observability, number>> = {
  none: 0,
  'structural-only': 1,
  'declared-only': 1,
  full: 2,
};

export function weaker(a: Observability, b: Observability): Observability {
  return RANK[a] <= RANK[b] ? a : b;
}

/** The weaker of two profiles' readings, band by band. */
export function sharedObservability(
  a: ObservationProfile,
  b: ObservationProfile,
): Record<Band, Observability> {
  const here = observableBands(a);
  const there = observableBands(b);

  return Object.fromEntries(
    BANDS.map((band) => [band, weaker(here[band], there[band])]),
  ) as Record<Band, Observability>;
}

/**
 * Bands a comparison could not decide at all.
 *
 * Derived from {@link sharedObservability} rather than computed beside it: a band
 * is unobserved exactly when the weaker of the two levels does not decide it, and
 * two expressions of one rule are two things that can disagree.
 */
export function unobservedBands(levels: Readonly<Record<Band, Observability>>): readonly Band[] {
  return BANDS.filter((band) => !decidesBand(band, levels[band]));
}

/**
 * Bands that were decided, but on less than the evidence the band is made of.
 *
 * The half of observability that has no verdict to hide behind. `unobserved` is
 * loud — a band with no answer is reported as having none — while a band decided
 * `declared-only` returns `unchanged`, in the same word a resolved cascade
 * returns, over a narrower question: JSDOM compares what an author wrote, so
 * `padding: 1rem` stays `1rem` and a root font-size that moved underneath it is
 * not in the comparison. That is a real answer and the reason the level decides
 * its band at all — but it is not the answer the word `unchanged` promises, and
 * a reader given the word without the level cannot tell which one they have.
 */
export function narrowedBands(levels: Readonly<Record<Band, Observability>>): readonly Band[] {
  return BANDS.filter((band) => decidesBand(band, levels[band]) && levels[band] !== 'full');
}
