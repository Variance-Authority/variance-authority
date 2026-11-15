import { caseBytes, invalid, rowsColumn, type RowsTable } from './case-lines.js';
import type { Stored } from './format-layout.js';
import { LAYOUT } from './record-layout.js';
import type { ExecutionTest } from './reverse.js';
import { put, varints } from './varints.js';

/**
 * How long each statement of a cut case took, as the case index stores it
 * beside the case's lines.
 *
 * A case's row is every line of the test file its body cut at, in the order
 * it first reached them, each with the whole microseconds it held on the real
 * clock, a loop's runs summed. Nothing is left out or ranked: a reader that
 * wants the slowest statement reads it off the row.
 *
 * The bytes of one case are varint pairs: the line as its zigzagged distance
 * from the line before it, the first from 0, then its microseconds. No bytes
 * at all is a case whose statements were not timed, which a record of uncut
 * files holds for every case; a timed case has at least one statement.
 */

/** One statement's time: its line in the test file and its whole microseconds. */
export interface CaseTime {
  readonly line: number;
  readonly time: number;
}

/**
 * A statement's whole percent of its case: its microseconds over the case's
 * milliseconds, never above the whole — two clocks time them, and a case
 * stopped beside others ends with its file. Absent where the runner reported
 * no duration, or none to divide by.
 */
export function shareOf(time: number, duration: number | undefined): number | undefined {
  if (duration === undefined || duration <= 0) return undefined;
  return Math.min(100, Math.round(time / (duration * 1000) * 100));
}

/** The column of each case's bytes, absent where no case was timed. */
export const TIMES_COLUMN = LAYOUT.cases.times;

/** Where each case's bytes begin in {@link TIMES_COLUMN}, and one past the last case's. */
export const TIMES_OFFSETS = LAYOUT.cases.timesOffsets;

/** One case's bytes, none for a case whose statements were not timed. */
export function encodeCaseTimes(times: readonly CaseTime[] | undefined): Uint8Array {
  if (times === undefined) return new Uint8Array(0);
  const out: number[] = [];
  let previous = 0;
  for (const { line, time } of times) {
    const step = line - previous;
    put(out, step < 0 ? -step * 2 - 1 : step * 2);
    put(out, time);
    previous = line;
  }
  return Uint8Array.from(out);
}

/** One case's times off its bytes, or undefined for a case that was not timed. */
export function decodeCaseTimes(bytes: Uint8Array): CaseTime[] | undefined {
  if (bytes.length === 0) return undefined;
  const read = varints(bytes, invalid);
  const times: CaseTime[] = [];
  let line = 0;
  while (!read.done) {
    const step = read.take();
    line += step % 2 === 1 ? -(step + 1) / 2 : step / 2;
    if (line < 0) throw invalid();
    times.push({ line, time: read.take() });
  }
  return times;
}

/** Each case's times as the column pair a case index stores, or no column where no case was timed. */
export function timesColumn(count: number, of: (at: number) => readonly CaseTime[] | undefined): Readonly<Record<string, Stored>> {
  const encoded = Array.from({ length: count }, (_, at) => encodeCaseTimes(of(at)));
  return encoded.every((bytes) => bytes.length === 0) ? {} : rowsColumn(encoded, TIMES_COLUMN, TIMES_OFFSETS);
}

/** One case's times off the column pair, as {@link ExecutionTest} carries them. */
export function timesFrom(table: RowsTable | undefined, test: number): Pick<ExecutionTest, 'times'> {
  if (table === undefined) return {};
  const times = decodeCaseTimes(caseBytes(table, test));
  return times === undefined ? {} : { times };
}
