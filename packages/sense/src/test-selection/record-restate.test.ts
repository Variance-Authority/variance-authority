import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { caseSectionsOf, recordOfCases, withCaseSections } from './case-record.js';
import { commitRunsFile, readCommitRuns, writeCommitRuns } from './commit-runs.js';
import { decodeTestCoverage, encodeTestCoverage } from './format.js';
import type { TestCoverage } from './index.js';
import { restateRecord } from './record-restate.js';

const MERGE = 'a'.repeat(40);
const LANDED = 'b'.repeat(40);
const BEFORE = 'c'.repeat(40);

/** A record a pull request's run made at its merge, standing one test at an earlier commit. */
const coverage: TestCoverage = {
  version: 3,
  instrumentation: 'fixture',
  commit: MERGE,
  tests: [{ file: 'test/ran.test.ts', complete: true, preconditions: [] }],
  modules: [{
    file: 'src/ran.ts', sourceDigest: 'ran', instrumented: true,
    blocks: [{ ordinal: 0, kind: 'module', digest: 'digest-ran', name: 'ran', path: 'ran', source: true, startLine: 1, endLine: 1, testFiles: ['test/ran.test.ts'] }],
  }],
};
const last = { commit: MERGE, before: BEFORE, at: '2026-11-12T21:13:48.631Z', files: ['test/ran.test.ts'], cases: [] };

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'variance-restate-'));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

async function recorded(): Promise<string> {
  const file = join(home, 'coverage.bin');
  await writeFile(file, withCaseSections(encodeTestCoverage(coverage), { last: Buffer.from(JSON.stringify(last)) }));
  await writeCommitRuns(commitRunsFile(file), {
    commit: MERGE,
    latest: last.at,
    runs: 1,
    landings: [],
    standing: [{ commit: BEFORE, files: ['test/other.test.ts'] }, { commit: MERGE, files: ['test/again.test.ts'] }],
  });
  return file;
}

describe('restateRecord', () => {
  it('names the landed commit wherever the record named the merge, and keeps what it observed and every other commit', async () => {
    const file = await recorded();

    expect(await restateRecord(file, MERGE, LANDED)).toEqual({ restated: true });

    const bytes = await readFile(file);
    expect(decodeTestCoverage(bytes)).toEqual({ ...coverage, commit: LANDED });
    expect(JSON.parse(Buffer.from(caseSectionsOf(bytes).last!).toString('utf8'))).toEqual({ ...last, commit: LANDED });
    const runs = await readCommitRuns(file);
    expect(runs?.commit).toBe(LANDED);
    expect(runs?.standing).toEqual([{ commit: BEFORE, files: ['test/other.test.ts'] }, { commit: LANDED, files: ['test/again.test.ts'] }]);
  });

  it('leaves a record made at another commit as it is, and names that commit', async () => {
    const file = await recorded();
    const bytes = await readFile(file);
    const runs = await readFile(commitRunsFile(file));

    expect(await restateRecord(file, BEFORE, LANDED)).toEqual({ madeAt: MERGE });

    expect(await readFile(file)).toEqual(bytes);
    expect(await readFile(commitRunsFile(file))).toEqual(runs);
  });

  it('restates a record of cases without coverage by the commit its last run names, the only one it holds', async () => {
    const file = join(home, 'coverage.bin');
    await writeFile(file, recordOfCases({ last: Buffer.from(JSON.stringify(last)) }));

    expect(await restateRecord(file, MERGE, LANDED)).toEqual({ restated: true });

    expect(JSON.parse(Buffer.from(caseSectionsOf(await readFile(file)).last!).toString('utf8'))).toEqual({ ...last, commit: LANDED });
  });

  it('leaves a record of cases without coverage whose last run names another commit as it is', async () => {
    const file = join(home, 'coverage.bin');
    const bytes = recordOfCases({ last: Buffer.from(JSON.stringify(last)) });
    await writeFile(file, bytes);

    expect(await restateRecord(file, BEFORE, LANDED)).toEqual({ madeAt: MERGE });
    expect(await readFile(file)).toEqual(bytes);
  });
});
