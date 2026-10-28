import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lastCaseRunOf } from './case-landing.js';
import { caseSectionsAt, sharedRecord, withCaseSections } from './case-record.js';
import { landRun } from './commit-runs.js';
import { CrossingSets } from './crossing-sets.js';
import { encodeSetExecutionIndex } from './execution-set-format.js';
import { writeTestCoverage, type TestCoverage } from './index.js';

/**
 * A record that crossed a checkout — a seed, a fetch of the mainline's, a
 * share — keeps its cases and names no last run. The first run laid over it
 * names the commit the record's snapshot stands at as its before layer's, so
 * a comparison with the cases it replaced has a commit to diff from.
 */

const BASE = 'b'.repeat(40);
const NOW = 'c'.repeat(40);

/** A case index naming one case of `a.test.ts`, which called nothing. */
function index(): Buffer {
  const sets = new CrossingSets(1);
  sets.intern([]);
  return encodeSetExecutionIndex({ tests: [{ id: 'a.test.ts > one', file: 'a.test.ts', name: 'one' }], modules: [], sets: sets.pool() });
}

/** A run of `a.test.ts` at `commit`, measuring `src/a.ts` when `covered`. */
function run(commit: string, covered: boolean): TestCoverage {
  return {
    version: 3,
    instrumentation: 'fixture',
    commit,
    tests: [{ file: 'a.test.ts', complete: true, preconditions: [] }],
    modules: covered ? [{ file: 'src/a.ts', sourceDigest: 'd', instrumented: false, blocks: [] }] : [],
  };
}

const fresh = () => ({ fresh: index(), run: { tests: [{ file: 'a.test.ts', complete: true }], commit: NOW } });

let root: string;
let record: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'variance-crossed-record-'));
  await writeFile(join(root, 'a.test.ts'), '');
  record = join(root, 'coverage.bin');
  // The record at `BASE` with its cases and the run that wrote them, then crossed.
  await writeTestCoverage(record, run(BASE, true));
  const last = Buffer.from(JSON.stringify({ commit: BASE, at: '2026-01-01T00:00:00.000Z', files: ['a.test.ts'], cases: ['a.test.ts > one'] }));
  await writeFile(record, sharedRecord(withCaseSections(readFileSync(record), { index: index(), last })));
  expect(caseSectionsAt(record).last).toBeUndefined();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('the first run over a record that crossed a checkout', () => {
  it('names the commit the snapshot stands at as the before layer\'s, when it measured something', async () => {
    await landRun(record, run(NOW, true), root, undefined, fresh());

    expect(lastCaseRunOf(caseSectionsAt(record))).toMatchObject({ commit: NOW, before: BASE });
  });

  it('names it too when it measured nothing and only its cases land', async () => {
    await landRun(record, run(NOW, false), root, undefined, fresh());

    expect(lastCaseRunOf(caseSectionsAt(record))).toMatchObject({ commit: NOW, before: BASE });
  });
});
