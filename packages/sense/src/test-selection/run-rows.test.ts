import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appendRunRow, MAX_RUN_ROWS, RUN_ROWS_WEEKS, readRunRows, runRowsFile } from './run-rows.js';

/** One summary row per recorded run, kept beside the record for a few weeks. */

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-25T12:00:00Z');
const at = (days: number) => new Date(NOW - days * DAY).toISOString();
const where = () => join(mkdtempSync(join(tmpdir(), 'va-rows-')), 'coverage.bin');

describe('the per-run summary rows', () => {
  it('keeps one row for each run recorded, oldest first', async () => {
    const coverage = where();
    await appendRunRow(coverage, { at: at(1), suite: 'unit', duration: 900, cases: 12 }, NOW - DAY);
    await appendRunRow(coverage, { at: at(0), suite: 'unit', duration: 1100, cases: 13 }, NOW);

    expect(readRunRows(coverage)).toEqual([
      { at: at(1), suite: 'unit', duration: 900, cases: 12 },
      { at: at(0), suite: 'unit', duration: 1100, cases: 13 },
    ]);
  });

  it('drops a row older than the window when the next run lands', async () => {
    const coverage = where();
    await appendRunRow(coverage, { at: at(RUN_ROWS_WEEKS * 7 + 1), duration: 1 }, NOW - (RUN_ROWS_WEEKS * 7 + 1) * DAY);
    await appendRunRow(coverage, { at: at(0), duration: 2 }, NOW);

    expect(readRunRows(coverage)).toEqual([{ at: at(0), duration: 2 }]);
  });

  it('keeps no more than the cap, the newest', async () => {
    const coverage = where();
    const rows = Array.from({ length: MAX_RUN_ROWS }, (_, n) => ({ at: new Date(NOW - 1000 + n).toISOString() }));
    writeFileSync(runRowsFile(coverage), JSON.stringify({ rows }));
    await appendRunRow(coverage, { at: at(0) }, NOW);

    const kept = readRunRows(coverage);
    expect(kept).toHaveLength(MAX_RUN_ROWS);
    expect(kept.at(-1)).toEqual({ at: at(0) });
    expect(kept[0]).toEqual(rows[1]);
  });

  it('writes a field the run could not tell as absent, never as zero', async () => {
    const coverage = where();
    await appendRunRow(coverage, { at: at(0) }, NOW);

    expect(readFileSync(runRowsFile(coverage), 'utf8')).not.toMatch(/duration|cases|suite/);
  });

  it('reads no rows where nothing was recorded, and starts again over a file it cannot read', async () => {
    const coverage = where();
    expect(readRunRows(coverage)).toEqual([]);
    writeFileSync(runRowsFile(coverage), '{not json');
    await appendRunRow(coverage, { at: at(0), cases: 1 }, NOW);

    expect(readRunRows(coverage)).toEqual([{ at: at(0), cases: 1 }]);
  });
});
