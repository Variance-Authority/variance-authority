// compass: variance-authority.reach.crossings
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memoryLineCell, publishLine } from '@variance-authority/core/share';
import { encodeTestCoverage, withCaseSections } from '@variance-authority/sense/test-selection';
import { describe, expect, it } from 'vitest';
// Sense publishes the case index's and the runs record's readers and not their
// writers, which only a recording run calls, so this writes them the way that run does.
import { commitRunsText } from '../../../sense/src/test-selection/commit-runs-text.js';
import { encodeAsSetExecutionIndex } from '../../../sense/src/test-selection/execution-set-format.js';
import { frame } from '../share-entries.js';
import { historyOf, seriesOf, summaryOf } from './view-history.js';
import { historyTab } from './view-history-tables.js';
import type { Table } from './view-rows.js';

/** What surrounded each kept run, as the History tab draws it: the highest load and RSS its lines ended at, and the machines that ran it. */

const DAY = 86_400_000;
const NOW = 1_900_000_000_000;
const commit = 'c'.repeat(40);

function record(timed: boolean): Uint8Array {
  const coverage = encodeTestCoverage({
    version: 3,
    instrumentation: 'fixture',
    commit,
    tests: [
      { file: 'test/a.test.ts', duration: 12, complete: true, preconditions: [] },
      { file: 'test/b.test.ts', duration: 30, complete: true, preconditions: [] },
    ],
    modules: [],
  });
  return withCaseSections(coverage, {
    index: encodeAsSetExecutionIndex({
      tests: [
        { id: 'a', file: 'test/a.test.ts', name: 'waits', duration: 9, ...(timed ? { times: [{ line: 4, time: 900, load: 2.5, rss: 1300 }, { line: 5, time: 10, load: 3.75, rss: 1200, free: 9000 }] } : {}) },
        { id: 'b', file: 'test/b.test.ts', name: 'pays', duration: 20, ...(timed ? { times: [{ line: 7, time: 20, load: 1, rss: 1500 }] } : {}) },
      ],
      modules: [],
    }),
  });
}

const RUNS = new TextEncoder().encode(
  commitRunsText({
    commit,
    latest: '2026-11-27T05:13:00.000Z',
    runs: 2,
    landings: [
      { files: ['test/a.test.ts'], machine: { arch: 'x64', cores: 4 } },
      { files: ['test/b.test.ts'], machine: { arch: 'arm64', cores: 12 } },
    ],
  }),
);

const column = (table: Table, name: string): unknown[] => {
  const at = table.columns.find((held) => held.name === name)!;
  return Array.from({ length: table.count }, (_, row) => at.at(row));
};

describe('the figures around each kept run', () => {
  it('carries the highest load and RSS any line of the run\'s cases ended at, and neither where none was read', () => {
    expect(summaryOf(record(true))).toMatchObject({ peakLoad: 3.75, peakRss: 1500 });
    expect(summaryOf(record(false))).not.toHaveProperty('peakLoad');
    expect(summaryOf(record(false))).not.toHaveProperty('peakRss');
  });

  it('names the machines the runs record beside the run names, with how many test files each ran, and none without one or from another commit', () => {
    expect(summaryOf(record(true), RUNS).machines).toEqual([['arm64, 12 cores', 1], ['x64, 4 cores', 1]]);
    expect(summaryOf(record(true))).not.toHaveProperty('machines');
    const elsewhere = new TextEncoder().encode(commitRunsText({ commit: 'd'.repeat(40), latest: '2026-11-27T05:13:00.000Z', runs: 1, landings: [{ files: ['test/a.test.ts'], machine: { arch: 'x64', cores: 4 } }] }));
    expect(summaryOf(record(true), elsewhere)).not.toHaveProperty('machines');
  });

  it('reads the machines from the runs record the share kept with each record', async () => {
    const cell = memoryLineCell(() => NOW - DAY);
    await publishLine(cell, { kind: 'mainline', name: 'main' }, [{ name: 'suite-v1/unit', commit, bytes: frame([['coverage.bin', record(true)], ['coverage.runs.json', RUNS]]) }], {
      descends: async () => false,
      image: async () => new Uint8Array(),
    });
    const history = await historyOf(cell, 'main', { since: 14 * DAY, now: NOW, cacheDir: mkdtempSync(join(tmpdir(), 'va-history-')), order: async () => [commit] });

    expect('points' in history && history.points.map(({ peakLoad, peakRss, machines }) => ({ peakLoad, peakRss, machines }))).toEqual([
      { peakLoad: 3.75, peakRss: 1500, machines: [['arm64, 12 cores', 1], ['x64, 4 cores', 1]] },
    ]);
  });

  it('shows each commit\'s peak load, peak RSS and machines in Commits, blank where its run kept none', () => {
    const summary = (bytes: Uint8Array, runs?: Uint8Array) => ({ commit, suite: 'unit', ...summaryOf(bytes, runs) });
    const series = seriesOf([{ ...summary(record(true), RUNS), written: 2 * DAY }, { ...summary(record(false)), written: DAY }], [commit]);
    const commits = historyTab({ ...series, since: 14 * DAY, skipped: [] }).tables().find(({ id }) => id === 'history-commits')!;

    expect(column(commits, 'peak load')).toEqual([3.75, undefined]);
    expect(column(commits, 'peak RSS MiB')).toEqual([1500, undefined]);
    expect(column(commits, 'machines')).toEqual(['1 on arm64, 12 cores; 1 on x64, 4 cores', undefined]);
  });
});
