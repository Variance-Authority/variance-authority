import { readFile, realpath, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  caseSectionsAt,
  encodeAsSetExecutionIndex,
  readTestCoverage,
  recordedEyesAt,
  rowOf,
  testCoverageFile,
  withCaseSections,
  type ExecutionTest,
} from '@variance-authority/sense/test-selection';
import { readFlags } from '../args.js';
import { parseCoveringArgs } from '../covering-args.js';
import { flagsFor, synopsisFor } from '../usage.js';
import { covering } from './covering.js';
import { readExecutionIndex } from './execution-input.js';
import { cloneOf, published, wholeRecord, DISCOUNTS } from './mainline-fixture.js';
import { layMainline, suiteBase } from './suite-base.js';

/**
 * A record's attribution crosses the mainline whole: CI publishes a record
 * holding the regions each test file entered, the conditions each case said it
 * ran under, and the Eyes journals each case handed over; a fresh clone fetches
 * it, lays it as its own, and reads all three back. Only the case history —
 * the before layer and the last run — stays behind, because it names runs of
 * the checkout that made them.
 */

let home: string;
const cwd = process.cwd();

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), 'variance-attribution-mainline-')));
});

afterEach(async () => {
  process.chdir(cwd);
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

const MOCKED = { name: 'network:api', value: 'mocked', site: 'test/total.test.ts:2', level: 1 };
const SAID: ExecutionTest = { ...DISCOUNTS, said: JSON.stringify({ said: [[MOCKED.name, JSON.stringify(MOCKED.value), MOCKED.site, MOCKED.level]] }) };
const JOURNAL = { complete: true, attention: [], by: 'ci' };
const EYES = { watched: [SAID.id], journals: [{ case: SAID.id, attempt: 1, journal: JOURNAL }] };

/** The record CI made in `dir`, its case saying what it arranged and handing over a journal, with the history a run leaves. */
async function attributed(dir: string): Promise<void> {
  await wholeRecord(dir);
  const record = testCoverageFile(dir, { suite: 'unit' });
  await writeFile(record, withCaseSections(await readFile(record), {
    index: encodeAsSetExecutionIndex({
      tests: [SAID],
      modules: [{
        file: 'src/total.ts',
        blocks: [{
          kind: 'function', name: 'applyDiscount', path: 'applyDiscount', startLine: 1, endLine: 3, source: true,
          crossings: [{ test: 0, distance: 0 }],
        }],
      }],
    }),
    before: encodeAsSetExecutionIndex({ tests: [], modules: [] }),
    last: Buffer.from(`${JSON.stringify({ at: '2026-01-01T00:00:00.000Z', files: [SAID.file], cases: [SAID.id] })}\n`),
    eyes: Buffer.from(`${JSON.stringify({ version: 1, ...EYES })}\n`),
  }));
}

/** `variance covering` run on `argv` as the command line parses it, in the current directory. */
function coveringOf(argv: readonly string[]) {
  return covering(parseCoveringArgs(readFlags(argv, 'covering', flagsFor('covering'), synopsisFor('covering'))));
}

describe('a record laid from the mainline', () => {
  it('carries the regions, the case preconditions and the Eyes journals CI published, and reads each back', async () => {
    vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'ci-cache'));
    const ci = await published(home, { record: attributed });
    const made = testCoverageFile(ci.dir, { suite: 'unit' });
    const clone = await cloneOf(home, ci.origin);
    vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'clone-cache'));
    const base = await suiteBase(clone, { env: {} });
    if (base.from !== 'mainline') throw new Error(`expected the mainline's record, read ${JSON.stringify(base)}`);

    const laid = testCoverageFile(clone, { suite: 'unit' });
    expect(await layMainline(clone, base.mainline, 'fixture')).toEqual({ laid });
    const ours = await readTestCoverage(made);
    expect((await readTestCoverage(laid)).modules).toEqual(ours.modules);
    const tests = (await readExecutionIndex(laid)).tests;
    expect(tests).toEqual([SAID]);
    expect(tests.map(rowOf)).toEqual([[MOCKED]]);
    expect(recordedEyesAt(laid)).toEqual(EYES);
    const { before, last } = caseSectionsAt(laid);
    expect({ before, last }).toEqual({ before: undefined, last: undefined });

    process.chdir(clone);
    const at = ['--file', 'src/total.ts', '--line', '2', '--root', clone, '--execution', laid];
    expect((await coveringOf([...at, '--where', 'network:api=mocked'])).tests).toEqual([{ ...SAID, distance: 0 }]);
    expect((await coveringOf([...at, '--where', 'network:api=live'])).tests).toEqual([]);
  });
});
