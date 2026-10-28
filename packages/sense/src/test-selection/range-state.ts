import type { CoveringRegion, SourceTestRange } from './reverse.js';

/**
 * What the record says about one range, as the one word every client paints.
 *
 * - `walked`: two or more cases called into it, or one did beside a case that
 *   stopped before it could be seen reaching the range.
 * - `alone`: exactly one case called into it, and every case that could have
 *   reached it finished.
 * - `loaded`: the only entry was while its module evaluated.
 * - `hole`: nobody entered it, and a case that could have reached it stopped.
 * - `unwalked`: nobody entered it, and every case that could have reached it
 *   finished.
 *
 * The rows are ranked so that the one that applies first wins, and the reader
 * ranks them, so two editors cannot paint one range differently. Absent when
 * the record cannot tell which applies: one witness, or none, with a case that
 * could have reached it and whose settling was not recorded.
 */
export type RangeState = 'walked' | 'alone' | 'loaded' | 'hole' | 'unwalked';

/**
 * How far the record says cases got into a range, the one reading every
 * covering answer and the review handover take a range's reach from:
 *
 * - `entered`: a case called into it.
 * - `loaded`: the only entry was while its module evaluated.
 * - `hole`: nobody entered it, and a case that could have reached it stopped.
 * - `unwalked`: nobody entered it, and every case that could have reached it
 *   finished.
 * - `unknown`: nobody entered it, and whether a case that could have reached
 *   it stopped was not recorded.
 */
export type Reach = 'entered' | 'loaded' | 'hole' | 'unwalked' | 'unknown';

/** The part of a range its reach and its state are read from. */
export type ReachRecord = Pick<SourceTestRange, 'tests' | 'loaded' | 'stopped'>;

/** The reach a range's cases, its load flag and its stopped cases add up to. */
export function reachOf(range: ReachRecord): Reach {
  if (range.tests.some((test) => test.loaded !== true)) return 'entered';
  if (range.tests.length > 0 || range.loaded === true) return 'loaded';
  if (range.stopped === undefined) return 'unknown';
  return range.stopped.length === 0 ? 'unwalked' : 'hole';
}

/** The one state a range's cases and stopped cases add up to, or absent. */
export function stateOf(range: ReachRecord): RangeState | undefined {
  const reach = reachOf(range);
  if (reach === 'unknown') return undefined;
  if (reach !== 'entered') return reach;
  if (range.tests.filter((test) => test.loaded !== true).length >= 2) return 'walked';
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
