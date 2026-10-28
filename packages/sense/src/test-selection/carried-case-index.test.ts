import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { INSTRUMENTATION_ID, instrument } from '../instrument/index.js';
import { caseSectionsAt } from './case-record.js';
import { landRun } from './commit-runs.js';
import { repinOwnLayer } from './milestone-repin.js';
import { writeOwnLayer } from './own-layer.js';
import { coverageBlock } from './coverage-rows.js';
import { CrossingSets } from './crossing-sets.js';
import { decodeExecutionIndex } from './execution-format.js';
import { NO_OWNER } from './format-layout.js';
import { encodeSetExecutionIndex } from './execution-set-format.js';
import { coveringTests } from './reverse.js';
import { readTestCoverage, testCoverageFile, type CoverageModule, type TestCoverage } from './index.js';

/**
 * A record whose case index holds a module, landed again by a run that did not
 * record that module while its text moved on disk. The snapshot re-cuts the
 * carried module's rows to the text on disk; these read whether the case index
 * beside them stands at the same lines, by asking it the question `variance
 * covering --line` asks.
 */

const FILE = 'src/math.ts';
const OTHER = 'src/other.ts';
const ONE = 'test/one.test.ts';
const TWO = 'test/two.test.ts';
const THREE = 'test/three.test.ts';

/** The line of each region that says which test runs it. */
const RUNS: Record<string, string> = { 'n + 1': ONE, 'n * 2': TWO };

const TEXT = 'export function a(n) {\n  return n + 1;\n}\n\nexport function b(n) {\n  return n * 2;\n}\n';
// Two lines written above the rest: every region keeps its address, two lines down.
const MOVED = `// one\n// two\n${TEXT}`;
// Callbacks told apart by their seat alone, and a third written in front of them
// with two lines above: the counter hands out another set of seats, so no
// address carries the rows onto the text on disk.
const SEATED = 'export default [\n  (n) => {\n    return n + 1;\n  },\n  (n) => {\n    return n * 2;\n  },\n];\n';
const RESEATED = '// one\n// two\nexport default [\n  (n) => {\n    return n - 1;\n  },\n  (n) => {\n    return n + 1;\n  },\n  (n) => {\n    return n * 2;\n  },\n];\n';
const OTHER_TEXT = 'export const other = 1;\n';

type Row = Omit<CoverageModule['blocks'][number], 'testFiles'>;

/** The regions of `text`, each with the tests of `tests` that ran it. */
function regionsOf(file: string, text: string, tests: readonly string[]): readonly { readonly block: Row; readonly ran: readonly string[] }[] {
  const lines = text.split('\n');
  return instrument(text, file, file)!.blocks.map((block) => {
    const { testFiles: _testFiles, ...row } = coverageBlock(text, block);
    if (row.kind === 'module') return { block: row, ran: tests };
    const body = lines.slice(row.startLine - 1, row.endLine).join('\n');
    const runner = Object.entries(RUNS).find(([marker]) => body.includes(marker))?.[1];
    return { block: row, ran: runner !== undefined && tests.includes(runner) ? [runner] : [] };
  });
}

function recording(file: string, text: string, tests: readonly string[], commit: string): TestCoverage {
  return {
    version: 3,
    instrumentation: INSTRUMENTATION_ID,
    commit,
    tests: tests.map((test) => ({ file: test, complete: true, preconditions: [{ name: test, digest: `source:${test}` }] })),
    modules: [{
      file,
      sourceDigest: instrument(text, file, file)!.sourceDigest,
      instrumented: true,
      blocks: regionsOf(file, text, tests).map(({ block, ran }) => ({ ...block, testFiles: [...ran] })),
    }],
  };
}

const caseOf = (file: string): string => `${file} > runs`;

/** The run's own case index: one case per test file, calling the regions of `file` its test ran. */
function casesOf(file: string, text: string, tests: readonly string[]): Uint8Array {
  const regions = regionsOf(file, text, tests);
  const sets = new CrossingSets(tests.length);
  sets.intern([]);
  return encodeSetExecutionIndex({
    tests: tests.map((test) => ({ id: caseOf(test), file: test, name: 'runs' })),
    modules: [{
      file,
      blocks: regions.map(({ block }) => ({
        kind: block.kind, name: block.name, path: block.path, startLine: block.startLine, endLine: block.endLine, source: block.source,
      })),
      called: Uint32Array.from(regions, ({ ran }) => sets.intern(ran.map((test) => tests.indexOf(test)))),
      loaded: new Uint8Array(regions.length),
      owner: Uint32Array.from(regions, ({ block }) =>
        (block.owner === undefined ? NO_OWNER : regions.findIndex((region) => region.block.ordinal === block.owner))),
    }],
    sets: sets.pool(),
  });
}

/** The line of `text` that holds `marker`, counted from one. */
const lineOf = (text: string, marker: string): number => text.split('\n').findIndex((line) => line.includes(marker)) + 1;

interface Landed {
  /** The cases `covering --line` names at each marker's line of the text on disk. */
  readonly covering: Record<string, readonly string[]>;
  /** The lines the rows and the case index hold each of `FILE`'s functions at. */
  readonly rows: readonly string[];
  readonly index: readonly string[] | undefined;
}

interface Repository {
  readonly root: string;
  readonly cacheRoot: string;
  readonly git: (...args: string[]) => Promise<string>;
}

/** `body` over a fresh repository whose one commit holds `text` at `FILE`, then what the record at `coverageFile` holds of it. */
async function inRepository(text: string, moved: string, body: (at: Repository) => Promise<string>): Promise<Landed> {
  const scratch = await realpath(await mkdtemp(resolve(tmpdir(), 'variance-carried-index-')));
  const root = resolve(scratch, 'repository');
  const cacheRoot = resolve(scratch, 'cache');
  try {
    await mkdir(resolve(root, 'src'), { recursive: true });
    await mkdir(resolve(root, 'test'), { recursive: true });
    for (const test of [ONE, TWO, THREE]) await writeFile(resolve(root, test), '', 'utf8');
    await writeFile(resolve(root, FILE), text, 'utf8');
    await writeFile(resolve(root, OTHER), OTHER_TEXT, 'utf8');
    const git = async (...args: string[]): Promise<string> =>
      (await promisify(execFile)('git', args, { cwd: root })).stdout.trim();
    await git('init', '--quiet');
    await git('config', 'user.email', 'fixture@example.invalid');
    await git('config', 'user.name', 'Fixture');
    await git('add', '--all');
    await git('commit', '--quiet', '--message', 'the mainline');
    const coverageFile = await body({ root, cacheRoot, git });

    const rows = (await readTestCoverage(coverageFile)).modules.find((module) => module.file === FILE)!;
    const index = decodeExecutionIndex(caseSectionsAt(coverageFile).index!);
    const held = index.modules.find((module) => module.file === FILE);
    const functions = (blocks: readonly { readonly kind: string; readonly name: string; readonly startLine?: number; readonly endLine?: number }[]) =>
      blocks.filter((block) => block.kind === 'function').map((block) => `${block.name} ${block.startLine}-${block.endLine}`);
    return {
      covering: Object.fromEntries(Object.keys(RUNS).map((marker) => [
        marker,
        coveringTests(index, { file: FILE, line: lineOf(moved, marker) }).map((test) => test.id).sort(),
      ])),
      rows: functions(rows.blocks),
      index: held === undefined ? undefined : functions(held.blocks),
    };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

const whole = (file: string) => ({ file, complete: true });

/**
 * The mainline's record over `text`, then `FILE` rewritten to `moved` and a run
 * of `THREE` landed over `recorded` alone, keeping its cases when `keeps` says so.
 */
function landOver(text: string, moved: string, keeps: boolean, recorded = OTHER): Promise<Landed> {
  return inRepository(text, moved, async ({ root, cacheRoot, git }) => {
    const commit = await git('rev-parse', 'HEAD');
    const coverageFile = testCoverageFile(root, { cacheRoot });
    await landRun(coverageFile, recording(FILE, text, [ONE, TWO], commit), root, cacheRoot, {
      fresh: casesOf(FILE, text, [ONE, TWO]),
      run: { tests: [whole(ONE), whole(TWO)], commit },
    });
    await writeFile(resolve(root, FILE), moved, 'utf8');
    const over = recorded === FILE ? moved : OTHER_TEXT;
    await landRun(coverageFile, recording(recorded, over, [THREE], commit), root, cacheRoot, keeps
      ? { fresh: casesOf(recorded, over, [THREE]), run: { tests: [whole(THREE)], commit } }
      : undefined);
    return coverageFile;
  });
}

/**
 * A checkout's record pinned at the mainline's first commit, holding a run of
 * `THREE` over `OTHER` alone; then a milestone over `text` at the next commit,
 * `FILE` rewritten to `moved` on disk, and the record repinned onto it.
 */
function repinOver(text: string, moved: string): Promise<Landed> {
  return inRepository(text, moved, async ({ root, cacheRoot, git }) => {
    const first = await git('rev-parse', 'HEAD');
    const coverageFile = testCoverageFile(root, { cacheRoot });
    await landRun(coverageFile, recording(OTHER, OTHER_TEXT, [THREE], first), root, cacheRoot, {
      fresh: casesOf(OTHER, OTHER_TEXT, [THREE]),
      run: { tests: [whole(THREE)], commit: first },
    });
    await writeOwnLayer(coverageFile, { pinned: { mainline: 'main', commit: first }, ran: [] });
    await git('commit', '--quiet', '--allow-empty', '--message', 'the milestone');
    const next = await git('rev-parse', 'HEAD');
    const milestone = testCoverageFile(root, { cacheRoot: resolve(cacheRoot, 'milestone') });
    await landRun(milestone, recording(FILE, text, [ONE, TWO], next), root, resolve(cacheRoot, 'milestone'), {
      fresh: casesOf(FILE, text, [ONE, TWO]),
      run: { tests: [whole(ONE), whole(TWO)], commit: next },
    });
    await writeFile(resolve(root, FILE), moved, 'utf8');
    const repinned = await repinOwnLayer(coverageFile, { mainline: 'main', commit: next, fetched: '', suite: 'default', coverage: milestone }, root);
    expect(repinned).toMatchObject({ repinned: true });
    return coverageFile;
  });
}

const EDITED = TEXT.replace('n * 2', 'n * 2 + 0');

/**
 * A milestone over `FILE` at the commit after the mainline's first, holding
 * `ONE` and `TWO`; then `b` edited and committed, `ONE` run over that edit, and
 * the record repinned onto the milestone. The cases `ONE` ran land on the
 * milestone's regions through the edit between the two texts.
 */
function repinOverEdit(): Promise<Landed> {
  return inRepository(TEXT, EDITED, async ({ root, cacheRoot, git }) => {
    const first = await git('rev-parse', 'HEAD');
    await git('commit', '--quiet', '--allow-empty', '--message', 'the milestone');
    const next = await git('rev-parse', 'HEAD');
    const milestone = testCoverageFile(root, { cacheRoot: resolve(cacheRoot, 'milestone') });
    await landRun(milestone, recording(FILE, TEXT, [ONE, TWO], next), root, resolve(cacheRoot, 'milestone'), {
      fresh: casesOf(FILE, TEXT, [ONE, TWO]),
      run: { tests: [whole(ONE), whole(TWO)], commit: next },
    });
    await writeFile(resolve(root, FILE), EDITED, 'utf8');
    await git('commit', '--quiet', '--all', '--message', 'the edit');
    const later = await git('rev-parse', 'HEAD');
    const coverageFile = testCoverageFile(root, { cacheRoot });
    await landRun(coverageFile, recording(FILE, EDITED, [ONE], later), root, cacheRoot, {
      fresh: casesOf(FILE, EDITED, [ONE]),
      run: { tests: [whole(ONE)], commit: later },
    });
    await writeOwnLayer(coverageFile, { pinned: { mainline: 'main', commit: first }, ran: [{ commit: later, files: [ONE] }] });
    const repinned = await repinOwnLayer(coverageFile, { mainline: 'main', commit: next, fetched: '', suite: 'default', coverage: milestone }, root);
    expect(repinned).toMatchObject({ repinned: true });
    return coverageFile;
  });
}

describe('a case index carried over a module whose text moved on disk', () => {
  it('stands at the lines the rows were re-cut to, when the run kept no cases', async () => {
    const landed = await landOver(TEXT, MOVED, false);

    expect(landed.rows).toEqual(['a 3-5', 'b 7-9']);
    expect(landed.covering).toEqual({ 'n + 1': [caseOf(ONE)], 'n * 2': [caseOf(TWO)] });
    expect(landed.index).toEqual(landed.rows);
  });

  it('stands at the lines the rows were re-cut to, when the run kept cases of another module', async () => {
    const landed = await landOver(TEXT, MOVED, true);

    expect(landed.index).toEqual(landed.rows);
    expect(landed.covering).toEqual({ 'n + 1': [caseOf(ONE)], 'n * 2': [caseOf(TWO)] });
  });

  it('stands at the lines on disk, where no address carries the rows onto the text there', async () => {
    // A callback written in front of two others moves their seats, so no
    // callback's address names one region in both cuts: the rows are re-cut to
    // the text on disk, each callback taking what the top level took, and the
    // index stands beside them.
    const landed = await landOver(SEATED, RESEATED, false);

    expect(landed.rows).toEqual(['anon#0 4-6', 'anon#1 7-9', 'anon#2 10-12']);
    expect(landed.index).toEqual(landed.rows);
  });

  it('stands at the lines the run recorded, with the cases of the callback the edit left alone', async () => {
    // The run's rows replace the module's. A callback and two comment lines
    // written in front of the two leave each of them whole, five lines down:
    // each keeps the case that ran it, and the one written in front has none.
    const landed = await landOver(SEATED, RESEATED, false, FILE);

    expect(landed.index).toEqual(['anon#0 4-6', 'anon#1 7-9', 'anon#2 10-12']);
    expect(landed.covering).toEqual({ 'n + 1': [caseOf(ONE)], 'n * 2': [caseOf(TWO)] });
  });

  it('stands at the lines the rows were re-cut to, when the record is repinned onto a newer milestone', async () => {
    const landed = await repinOver(TEXT, MOVED);

    expect(landed.rows).toEqual(['a 3-5', 'b 7-9']);
    expect(landed.index).toEqual(landed.rows);
    expect(landed.covering).toEqual({ 'n + 1': [caseOf(ONE)], 'n * 2': [caseOf(TWO)] });
  });

  it('carries the milestone cases only onto the regions the checkout left alone, when the record is repinned', async () => {
    const landed = await repinOverEdit();

    expect(landed.covering).toEqual({ 'n + 1': [caseOf(ONE)], 'n * 2': [] });
  });
});
