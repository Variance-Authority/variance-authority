// compass: variance-authority.reach
/**
 * The one status of each line a `covering` question asks, decided once over
 * both sources. A line the record places is read from the case index: a case
 * the answer counts called into its regions, so it ran; else a case is flagged
 * there as having run it over a text a later run wrote over, so which case ran
 * it is not known; else no case ran it. A line the record has no place for is
 * read from the texts the cases that entered the file ran over: not known when
 * one of them holds it unmoved, written since the recording when none does.
 *
 * Nothing else writes `written` or `overwritten`, so a line is never in both,
 * and never beside a case the answer names as having run it.
 */

import { runsOfLines } from './covering-at.js';
import type { Covering } from './covering.js';

/** The lines a question asks, as the case index reads them, before the texts the cases ran over are read. */
export interface AskedLines {
  /** Each asked line a recorded region holds. */
  readonly placed: readonly PlacedLine[];
  /** In the held text: the asked lines the record has no place for. */
  readonly unplaced: readonly number[];
}

/** An asked line a recorded region holds: where it stands in the held text, and what the case index says of the recorded line it is placed at. */
export interface PlacedLine {
  readonly held: number;
  /** Whether a case the answer counts called into a region the recorded line lands on. */
  readonly called: () => boolean;
  /** Whether a region the recorded line lands on holds a case flagged as having run it over a text written over since. */
  readonly flagged: () => boolean;
}

/**
 * The asked lines whose run the record did not measure, by status, each as
 * ascending runs; a status no line has is absent. `ranOver` says whether a case
 * that entered the file ran over a text holding an unplaced line.
 */
export function lineStatus(asked: AskedLines, ranOver: (held: number) => boolean): Pick<Covering, 'written' | 'overwritten'> {
  const overwritten: number[] = [];
  const written: number[] = [];
  for (const line of asked.placed) if (line.flagged() && !line.called()) overwritten.push(line.held);
  for (const held of asked.unplaced) (ranOver(held) ? overwritten : written).push(held);
  const ascending = (lines: number[]) => runsOfLines([...new Set(lines)].sort((left, right) => left - right));
  return {
    ...(written.length === 0 ? {} : { written: ascending(written) }),
    ...(overwritten.length === 0 ? {} : { overwritten: ascending(overwritten) }),
  };
}
