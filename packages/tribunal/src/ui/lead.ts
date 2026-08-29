/**
 * The leading cause of a subject, written once so four readings cannot disagree.
 *
 * The rule: the **first** region the report marked as a cause, never the largest.
 * Ranking by area names the container that reflowed instead of the edit that moved
 * it — measured at 6× on one change — and the report already ordered its regions
 * by what it believed caused them.
 *
 * It was written out four times before this: the docket filed a subject under one
 * component, the rail labelled it, the record queried it, and the map read it. All
 * four agreed by coincidence and by review. A rule reimplemented per caller is one
 * edit away from a page that files a subject under one name and explains it under
 * another, and that is the failure nobody would see — both halves stay plausible.
 */

import type { RegionRecord } from '@variance-authority/report';

/** The region the report blamed, or `undefined` when it blamed none. */
export function leadOf(subject: {
  readonly regions: readonly RegionRecord[];
}): RegionRecord | undefined {
  return subject.regions.find((region) => region.cause === true);
}

/** The component that region names, when it named one. */
export function causeOf(subject: { readonly regions: readonly RegionRecord[] }): string | undefined {
  return leadOf(subject)?.component;
}

/**
 * The shape of the leading difference, when the run recorded one.
 *
 * Absent is not *the same shape as something else*. Two runs whose leading
 * regions both recorded nothing are two runs that said nothing, and a comparison
 * treating that as a match would report *the identical difference again* about a
 * pair nothing measured.
 */
export function shapeOf(subject: { readonly regions: readonly RegionRecord[] }): string | undefined {
  return leadOf(subject)?.fingerprint;
}
