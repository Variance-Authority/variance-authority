import caseOwner from './case-owner.cjs';
import { caseBytes, invalid, rowsColumn, type RowsTable } from './case-lines.js';
import type { Stored } from './format-layout.js';
import { LAYOUT } from './record-layout.js';
import type { ExecutionTest } from './reverse.js';
import { put, varints } from './varints.js';

/**
 * How long each statement of a cut case took, and what surrounded it, as the
 * case index stores it beside the case's lines: every line its body cut at, in
 * the order it first reached them, each with its whole microseconds on the real
 * clock, a loop's runs summed. Nothing is left out or ranked: a reader that
 * wants the slowest statement reads it off the row. No bytes is a case whose
 * statements were not timed; a timed case has at least one.
 */

/**
 * One statement's time: its line in the test file and its whole microseconds,
 * beside what surrounded it as it ended, each absent where it was not read.
 * Each is one draw of a figure that moves on its own, for a reader to see:
 * nothing selects, keys or judges a case by it.
 */
export interface CaseTime {
  readonly line: number;
  readonly time: number;
  /** The machine's 1-minute load average, to the hundredth. */
  readonly load?: number;
  /** The test process's resident memory, in whole MiB. */
  readonly rss?: number;
  /** The machine's free memory, in whole MiB. */
  readonly free?: number;
  /** The nodes the statement added to the page, each once where it was inserted. */
  readonly added?: number;
}

/** What surrounded a statement, in the order its row keeps them. */
export const FIGURES = caseOwner.FIGURES;

/** A figure as its row keeps it: a whole number, the load in hundredths. */
const stored = (figure: (typeof FIGURES)[number], value: number): number => (figure === 'load' ? Math.round(value * 100) : value);
const zigzag = (step: number): number => (step < 0 ? -step * 2 - 1 : step * 2);
const unzigzag = (word: number): number => (word % 2 === 1 ? -(word + 1) / 2 : word / 2);

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

/**
 * What surrounded a statement as it ended, as a reader prints it beside the
 * statement's time, `as it ended: load 16.25, RSS 300 MiB, 0 MiB free, 31
 * nodes added`, each figure named only where it was read; undefined where none
 * was.
 */
export function aroundText(time: Pick<CaseTime, (typeof FIGURES)[number]>): string | undefined {
  const named = [
    time.load === undefined ? undefined : `load ${time.load}`,
    time.rss === undefined ? undefined : `RSS ${time.rss} MiB`,
    time.free === undefined ? undefined : `${time.free} MiB free`,
    time.added === undefined ? undefined : `${time.added} ${time.added === 1 ? 'node' : 'nodes'} added`,
  ].filter((figure) => figure !== undefined);
  return named.length === 0 ? undefined : `as it ended: ${named.join(', ')}`;
}

/** The column of each case's bytes, absent where no case was timed. */
export const TIMES_COLUMN = LAYOUT.cases.times;

/** Where each case's bytes begin in {@link TIMES_COLUMN}, and one past the last case's. */
export const TIMES_OFFSETS = LAYOUT.cases.timesOffsets;

/**
 * One case's bytes: varint pairs, the line as its zigzagged step from the line
 * before, the first from 0, then its microseconds. A row that read a figure
 * starts with 0, which no first line is, and follows each pair with a digit in
 * base 3 a figure — absent, held, moved — and each moved value: a level's
 * zigzagged step from the last it read, from 0, or the count of added nodes,
 * held at 0. A statement whose surroundings stood still costs one byte.
 */
export function encodeCaseTimes(times: readonly CaseTime[] | undefined): Uint8Array {
  if (times === undefined) return new Uint8Array(0);
  const around = times.some((time) => FIGURES.some((figure) => time[figure] !== undefined));
  const out: number[] = around ? [0] : [];
  const last = [0, 0, 0];
  let previous = 0;
  for (const time of times) {
    put(out, zigzag(time.line - previous));
    put(out, time.time);
    previous = time.line;
    if (!around) continue;
    let digits = 0;
    const moved: number[] = [];
    FIGURES.forEach((figure, at) => {
      const value = time[figure];
      if (value === undefined) return;
      const word = stored(figure, value);
      const step = figure === 'added' ? word : zigzag(word - last[at]!);
      if (figure !== 'added') last[at] = word;
      digits += (step === 0 ? 1 : 2) * 3 ** at;
      if (step !== 0) moved.push(step);
    });
    put(out, digits);
    for (const step of moved) put(out, step);
  }
  return Uint8Array.from(out);
}

/** One case's times off its bytes, or undefined for a case that was not timed. */
export function decodeCaseTimes(bytes: Uint8Array): CaseTime[] | undefined {
  if (bytes.length === 0) return undefined;
  const around = bytes[0] === 0;
  const read = varints(around ? bytes.subarray(1) : bytes, invalid);
  const times: CaseTime[] = [];
  const last = [0, 0, 0];
  let line = 0;
  while (!read.done) {
    line += unzigzag(read.take());
    if (line < 0) throw invalid();
    const time = { line, time: read.take() };
    if (!around) {
      times.push(time);
      continue;
    }
    let digits = read.take();
    if (digits >= 3 ** FIGURES.length) throw invalid();
    const figures: [string, number][] = [];
    FIGURES.forEach((figure, at) => {
      const digit = digits % 3;
      digits = (digits - digit) / 3;
      if (digit === 0) return;
      const step = digit === 2 ? read.take() : 0;
      const word = figure === 'added' ? step : (last[at] = last[at]! + unzigzag(step));
      if (word < 0) throw invalid();
      figures.push([figure, figure === 'load' ? word / 100 : word]);
    });
    times.push({ ...time, ...Object.fromEntries(figures) });
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
