import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { writeCoverageBytes } from './record-location.js';

/**
 * One summary row for each run recorded: when it landed, which suite, how long
 * its tests took in all, how many cases it observed. Beside the record, so it
 * travels as far as the record's cache does and no further.
 *
 * A figure the run could not tell is absent from the row, never zero. There are
 * no outcome counts: a run's pass and fail tally is the report's, and a record
 * of them here would be a second owner of that answer.
 *
 * Bounded twice, because a cache is kept for months: a row older than
 * {@link RUN_ROWS_WEEKS} weeks goes when the next run lands, and no more than
 * {@link MAX_RUN_ROWS} are kept, the newest.
 */
export interface RunRow {
  /** When the run was recorded, an ISO timestamp. */
  at: string;
  suite?: string;
  /** Milliseconds the run's subjects took, summed. */
  duration?: number;
  /** Cases the run observed. */
  cases?: number;
}

/** How many weeks a row is kept: history windows are weeks, never a year. */
export const RUN_ROWS_WEEKS = 4;
/** The most rows kept, whatever their age. */
export const MAX_RUN_ROWS = 400;

const WEEK = 7 * 24 * 60 * 60 * 1000;

/** The row for a run recorded at `when`: what the run could not tell is left out. */
export function runRowOf(
  when: Date,
  suite: string | undefined,
  subjects: readonly { readonly duration?: number }[],
  cases: number,
): RunRow {
  const timed = subjects.filter((subject) => subject.duration !== undefined);
  return {
    at: when.toISOString(),
    ...(suite === undefined ? {} : { suite }),
    ...(timed.length === 0 ? {} : { duration: timed.reduce((total, subject) => total + (subject.duration ?? 0), 0) }),
    ...(cases === 0 ? {} : { cases }),
  };
}

/** The rows' file, beside the record: `coverage.bin` keeps `coverage.rows.json`. */
export function runRowsFile(coverageFile: string): string {
  const stem = coverageFile.endsWith('.bin') ? coverageFile.slice(0, -'.bin'.length) : coverageFile;
  return `${stem}.rows.json`;
}

/** The rows held beside a record, oldest first; none where there is no file or it cannot be read. */
export function readRunRows(coverageFile: string): RunRow[] {
  try {
    return rowsOf(readFileSync(runRowsFile(coverageFile), 'utf8'));
  } catch {
    return [];
  }
}

/** Lays one row after the rows held, drops what the window and the cap no longer keep. */
export async function appendRunRow(coverageFile: string, row: RunRow, now: number = Date.now()): Promise<void> {
  const held = await readFile(runRowsFile(coverageFile), 'utf8').then(rowsOf).catch(() => []);
  const since = now - RUN_ROWS_WEEKS * WEEK;
  const kept = [...held, row].filter((each) => Date.parse(each.at) >= since).slice(-MAX_RUN_ROWS);
  await writeCoverageBytes(runRowsFile(coverageFile), new TextEncoder().encode(JSON.stringify({ rows: kept })));
}

function rowsOf(text: string): RunRow[] {
  const parsed = JSON.parse(text) as { rows?: unknown };
  if (!Array.isArray(parsed.rows)) return [];
  return parsed.rows.filter(
    (row): row is RunRow => typeof row === 'object' && row !== null && typeof (row as RunRow).at === 'string',
  );
}
