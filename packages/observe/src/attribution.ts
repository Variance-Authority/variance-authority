import {
  causesBetween,
  movedBandsBetween,
  type ComponentBands,
  type ComponentHash,
} from '@variance-authority/core';

/**
 * What two sets of component hashes say about who moved, and in what sense.
 *
 * One function because the two answers have to arrive together or not at all.
 * They are read from the same pair of sidecars and they are absent under the
 * same condition, and a caller that computed them separately would eventually
 * compute one of them from a baseline that carried hashes and the other from a
 * baseline that did not — which is not a smaller answer, it is a report whose
 * ordering and whose explanation disagree about which components exist.
 *
 * Spread rather than returned as a pair, so an absent comparison omits the keys
 * instead of setting them to `undefined`. That is the same rule the rest of the
 * record follows and it matters more here than anywhere: `causes: []` reads as
 * *nothing caused this difference*, which is the strongest claim a comparison
 * can make, and it is the one a baseline with no hashes has no standing to make
 * at all.
 */
export function attributionOf(
  before: readonly ComponentHash[] | undefined,
  after: readonly ComponentHash[] | undefined,
): { causes?: readonly string[]; moved?: readonly ComponentBands[] } {
  // Both sides, or nothing. A comparison against a baseline that carries no
  // hashes cannot tell a cause from a passenger, and inventing an empty list
  // would report every component as collateral — a confident wrong ordering
  // rather than an absent one.
  if (before === undefined || after === undefined) return {};

  return { causes: causesBetween(before, after), moved: movedBandsBetween(before, after) };
}
