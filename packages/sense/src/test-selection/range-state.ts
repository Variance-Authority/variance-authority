import type { SourceTestRange } from './reverse.js';

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

/** The one state a range's cases and stopped cases add up to, or absent. */
export function stateOf(range: SourceTestRange): RangeState | undefined {
  const called = range.tests.filter((test) => test.loaded !== true).length;
  if (called >= 2) return 'walked';
  if (called === 1) {
    if (range.stopped === undefined) return undefined;
    return range.stopped.length === 0 ? 'alone' : 'walked';
  }
  if (range.tests.length > 0 || range.loaded === true) return 'loaded';
  if (range.stopped === undefined) return undefined;
  return range.stopped.length === 0 ? 'unwalked' : 'hole';
}
