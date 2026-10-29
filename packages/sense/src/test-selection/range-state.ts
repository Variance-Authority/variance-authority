import type { CoveringRegion, SourceTestRange } from './reverse.js';

/**
 * The one word every client paints for a range, ranked by the reader: an
 * `entered` {@link Reach} is `walked` when two or more cases called in, or one
 * did beside a case that stopped or whose run of it is not known, and `alone`
 * when one did and every case that could have reached it finished; any other
 * reach is its own word. Absent when the reach is `overwritten` or `unknown`,
 * or when one case called in and whether the others stopped was not recorded.
 */
export type RangeState = 'walked' | 'alone' | 'loaded' | 'hole' | 'unwalked';

/**
 * How far the record says cases got into a range, read by every covering answer
 * and the review: `entered`, a case called in; `loaded`, only while its module
 * evaluated; `overwritten`, a case ran it in a text an edit wrote over, so which
 * case is not known; and with nobody in, `hole` when a case that could have
 * reached it stopped, `unwalked` when each finished, `unknown` when not recorded.
 */
export type Reach = 'entered' | 'loaded' | 'overwritten' | 'hole' | 'unwalked' | 'unknown';

/** The part of a range its reach and its state are read from. */
export type ReachRecord = Pick<SourceTestRange, 'tests' | 'loaded' | 'stopped' | 'overwritten'>;

/** The reach a range's cases, its load flag, its stopped cases and its cases not known to have run it add up to. */
export function reachOf(range: ReachRecord): Reach {
  if (range.tests.some((test) => test.loaded !== true)) return 'entered';
  if ((range.overwritten?.length ?? 0) > 0) return 'overwritten';
  if (range.tests.length > 0 || range.loaded === true) return 'loaded';
  if (range.stopped === undefined) return 'unknown';
  return range.stopped.length === 0 ? 'unwalked' : 'hole';
}

/** The one state a range's cases and stopped cases add up to, or absent. */
export function stateOf(range: ReachRecord): RangeState | undefined {
  const reach = reachOf(range);
  if (reach === 'overwritten' || reach === 'unknown') return undefined;
  if (reach !== 'entered') return reach;
  if (range.tests.filter((test) => test.loaded !== true).length >= 2) return 'walked';
  if ((range.overwritten?.length ?? 0) > 0) return 'walked';
  if (range.stopped === undefined) return undefined;
  return range.stopped.length === 0 ? 'alone' : 'walked';
}

/**
 * The record a changed region's reach and state are read from: its callers,
 * and its passengers as cases that were inside it only while its module
 * evaluated, which is what `loaded` means on a range.
 */
export function regionRecord(region: CoveringRegion): ReachRecord {
  return {
    ...region,
    tests: [...region.tests, ...(region.passengers ?? []).map((test) => ({ ...test, loaded: true as const }))],
  };
}
