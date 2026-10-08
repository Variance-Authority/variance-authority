import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { INSTRUMENTATION_ID, instrument } from '../instrument/index.js';
import { caseSectionsAt } from './case-record.js';
import { landRun } from './commit-runs.js';
import { coverageBlock } from './coverage-rows.js';
import { CrossingSets } from './crossing-sets.js';
import { decodeExecutionIndex } from './execution-format.js';
import { encodeSetExecutionIndex } from './execution-set-format.js';
import { readTestCoverage, testCoverageFile, type CoverageModule, type TestCoverage } from './index.js';

/**
 * A local run made at the mainline's own commit, over a text with a function
 * written in front of one the mainline recorded. The run re-records only the
 * test for the new function, so the older tests' crossings are carried onto the
 * regions it cut. These land both runs the way a runner's teardown does and read
 * where each older test's crossings are afterwards, by the text of the region.
 *
 * A named function keeps its address, so the older tests land on the region
 * they ran. An anonymous one is addressed by its seat among its siblings, and
 * the function written in front takes the seat the recorded one held: carried
 * by address, its test would land on a region it never ran, and the region it
 * did run would read as entered by nobody. Nothing is carried across that
 * shift, and the tests that were on the module are run again.
 */

const FILE = 'src/handlers.ts';
const ONE = 'test/one.test.ts';
const TWO = 'test/two.test.ts';
const THREE = 'test/three.test.ts';

/** The line of each region that says which test runs it. */
const RUNS: Record<string, string> = { 'n + 1': ONE, 'n * 2': TWO, 'n - 1': THREE };

const NAMED = 'export function a(n) {\n  return n + 1;\n}\n\nexport function b(n) {\n  return n * 2;\n}\n';
const NAMED_INSERTED = NAMED.replace('export function b', 'export function inserted(n) {\n  return n - 1;\n}\n\nexport function b');
const ANONYMOUS = 'export const handlers = [\n  (n) => {\n    return n + 1;\n  },\n  (n) => {\n    return n * 2;\n  },\n];\n';
const ANONYMOUS_INSERTED = ANONYMOUS.replace('  (n) => {\n    return n * 2;', '  (n) => {\n    return n - 1;\n  },\n  (n) => {\n    return n * 2;');

interface Region {
  readonly block: Omit<CoverageModule['blocks'][number], 'testFiles'>;
  /** The tests that ran the region: every test of the run for the module, the one its body names otherwise. */
  readonly ran: readonly string[];
}

/** The regions of `text`, each with the tests of `tests` that ran it. */
function regionsOf(text: string, tests: readonly string[]): readonly Region[] {
  const lines = text.split('\n');
  return instrument(text, FILE, FILE)!.blocks.map((block) => {
    const { testFiles: _testFiles, ...row } = coverageBlock(text, block);
    if (row.kind === 'module') return { block: row, ran: tests };
    const body = lines.slice(row.startLine - 1, row.endLine).join('\n');
    const runner = Object.entries(RUNS).find(([marker]) => body.includes(marker))?.[1];
    return { block: row, ran: runner !== undefined && tests.includes(runner) ? [runner] : [] };
  });
}

function recording(text: string, tests: readonly string[], commit: string): TestCoverage {
  const fresh = instrument(text, FILE, FILE)!;
  return {
    version: 3,
    instrumentation: INSTRUMENTATION_ID,
    commit,
    tests: tests.map((file) => ({ file, complete: true, preconditions: [{ name: file, digest: `source:${file}` }] })),
    modules: [{
      file: FILE,
      sourceDigest: fresh.sourceDigest,
      instrumented: true,
      blocks: regionsOf(text, tests).map(({ block, ran }) => ({ ...block, testFiles: [...ran] })),
    }],
  };
}

const caseOf = (file: string): string => `${file} > runs`;

/** The run's own case index: one case per test file, calling the regions its file ran. */
function casesOf(text: string, tests: readonly string[]): Uint8Array {
  const regions = regionsOf(text, tests);
  const sets = new CrossingSets(tests.length);
  sets.intern([]);
  return encodeSetExecutionIndex({
    tests: tests.map((file) => ({ id: caseOf(file), file, name: 'runs' })),
    modules: [{
      file: FILE,
      blocks: regions.map(({ block }) => ({
        kind: block.kind, name: block.name, path: block.path, startLine: block.startLine, endLine: block.endLine, source: block.source,
      })),
      called: Uint32Array.from(regions, ({ ran }) => sets.intern(ran.map((file) => tests.indexOf(file)))),
      loaded: new Uint8Array(regions.length),
    }],
    sets: sets.pool(),
  });
}

/** Which region, named by the line that says who runs it, each landed test or case is on. */
function landedOn(text: string, blocks: readonly { readonly kind: string; readonly startLine: number; readonly endLine: number; readonly on: readonly string[] }[]): Record<string, string[]> {
  const lines = text.split('\n');
  const on: Record<string, string[]> = {};
  for (const block of blocks) {
    if (block.kind === 'module') continue;
    const body = lines.slice(block.startLine - 1, block.endLine).join('\n');
    const marker = Object.keys(RUNS).find((key) => body.includes(key)) ?? `${block.startLine}-${block.endLine}`;
    on[marker] = [...block.on].sort();
  }
  return on;
}

interface Landed {
  readonly coverage: Record<string, string[]>;
  readonly cases: Record<string, string[]>;
  /** The tests the record holds as wholly recorded. */
  readonly complete: readonly string[];
}

async function landBoth(base: string, dirty: string): Promise<Landed> {
  const scratch = await realpath(await mkdtemp(resolve(tmpdir(), 'variance-region-drift-')));
  const root = resolve(scratch, 'repository');
  const cacheRoot = resolve(scratch, 'cache');
  try {
    await mkdir(resolve(root, 'src'), { recursive: true });
    await mkdir(resolve(root, 'test'), { recursive: true });
    for (const test of [ONE, TWO, THREE]) await writeFile(resolve(root, test), '', 'utf8');
    await writeFile(resolve(root, FILE), base, 'utf8');
    const git = async (...args: string[]): Promise<string> =>
      (await promisify(execFile)('git', args, { cwd: root })).stdout.trim();
    await git('init', '--quiet');
    await git('config', 'user.email', 'fixture@example.invalid');
    await git('config', 'user.name', 'Fixture');
    await git('add', '--all');
    await git('commit', '--quiet', '--message', 'the mainline');
    const commit = await git('rev-parse', 'HEAD');
    const coverageFile = testCoverageFile(root, { cacheRoot });
    const whole = (file: string) => ({ file, complete: true });

    // The mainline's record, made over the committed text.
    await landRun(coverageFile, recording(base, [ONE, TWO], commit), root, cacheRoot, {
      fresh: casesOf(base, [ONE, TWO]),
      run: { tests: [whole(ONE), whole(TWO)], commit },
    });
    // A local leg at the same commit, over a text with a function written in.
    await writeFile(resolve(root, FILE), dirty, 'utf8');
    await landRun(coverageFile, recording(dirty, [THREE], commit), root, cacheRoot, {
      fresh: casesOf(dirty, [THREE]),
      run: { tests: [whole(THREE)], commit },
    });

    const landed = await readTestCoverage(coverageFile);
    const module = landed.modules.find((row) => row.file === FILE)!;
    const index = decodeExecutionIndex(caseSectionsAt(coverageFile).index!);
    const caseModule = index.modules.find((row) => row.file === FILE)!;
    return {
      coverage: landedOn(dirty, module.blocks.map((block) => ({ ...block, on: block.testFiles }))),
      cases: landedOn(dirty, caseModule.blocks.map((block) => ({ ...block, on: block.crossings.map((crossing) => index.tests[crossing.test]!.id) }))),
      complete: landed.tests.filter((test) => test.complete).map((test) => test.file).sort(),
    };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

describe('a local leg at the mainline commit, over a function written in front of a recorded one', () => {
  it('keeps each older test on the region it ran when the function is named', async () => {
    const { coverage, cases, complete } = await landBoth(NAMED, NAMED_INSERTED);

    // The new region also reads the crossings of the module around it, the
    // rule for a region no run has been asked about (`crossingsAround`), and
    // its cases are the cases of that module, by the same rule.
    expect(coverage).toEqual({ 'n + 1': [ONE], 'n * 2': [TWO], 'n - 1': [ONE, THREE, TWO] });
    expect(cases).toEqual({ 'n + 1': [caseOf(ONE)], 'n * 2': [caseOf(TWO)], 'n - 1': [caseOf(ONE), caseOf(THREE), caseOf(TWO)] });
    // The module's own region changed text, so the tests on it run again.
    expect(complete).toEqual([THREE]);
  });

  it('carries no older test onto a sibling that took its seat, and runs those tests again', async () => {
    const { coverage, cases, complete } = await landBoth(ANONYMOUS, ANONYMOUS_INSERTED);

    expect(coverage).toEqual({ 'n + 1': [], 'n * 2': [], 'n - 1': [THREE] });
    expect(cases).toEqual({ 'n + 1': [], 'n * 2': [], 'n - 1': [caseOf(THREE)] });
    expect(complete).toEqual([THREE]);
  });
});
