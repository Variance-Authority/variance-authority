import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { relationsOfFiles } from '@variance-authority/core/relate';
import { digestString } from '../digest.js';
import { scanRelations } from '../scan.js';
import { landRun } from './commit-runs.js';
import { changedLines, keptDigests, keptTexts, narrowByExecution, testCoverageFile, type TestCoverage } from './index.js';
import { withRanOver } from './ran-over.js';
import { textAtRecording } from './recorded-text.js';

/**
 * A green run over a text means the next selection over the same text skips
 * what ran it. A test's own file has no row: the run holds it as a
 * precondition, with the digest of the text the test ran over. These record
 * over a dirty tree in a real repository, land the run the way a runner's
 * teardown does, and ask again the way `variance select` does: the diff from
 * the recording's commit, the text at that commit, and the kept texts.
 */

const SOURCE = 'src/two.ts';
const TEST = 'test/two.test.ts';
const COMMITTED_SOURCE = 'export function two(value) {\n  return value * 2;\n}\n';
const EDITED_SOURCE = COMMITTED_SOURCE.replace('value * 2', 'value * 3');
const COMMITTED_TEST = "import { two } from '../src/two.ts';\n\nit('doubles', () => {\n  expect(two(1)).toBe(2);\n});\n";
const EDITED_TEST = COMMITTED_TEST.replace("it('doubles', () => {\n", "it('doubles', () => {\n  expect(two(0)).toBe(0);\n");

interface Checkout {
  readonly root: string;
  readonly cacheRoot: string;
  readonly commit: string;
  readonly git: (...args: string[]) => Promise<string>;
}

async function checkout<T>(run: (at: Checkout) => Promise<T>): Promise<T> {
  const scratch = await realpath(await mkdtemp(resolve(tmpdir(), 'variance-ran-over-')));
  const root = resolve(scratch, 'repository');
  const cacheRoot = resolve(scratch, 'cache');
  try {
    await mkdir(resolve(root, 'src'), { recursive: true });
    await mkdir(resolve(root, 'test'), { recursive: true });
    await writeFile(resolve(root, SOURCE), COMMITTED_SOURCE, 'utf8');
    await writeFile(resolve(root, TEST), COMMITTED_TEST, 'utf8');
    await writeFile(resolve(root, SETUP), COMMITTED_SETUP, 'utf8');
    const git = async (...args: string[]): Promise<string> => (await promisify(execFile)('git', args, { cwd: root })).stdout.trim();
    await git('init', '--quiet');
    await git('config', 'user.email', 'fixture@example.invalid');
    await git('config', 'user.name', 'Fixture');
    await git('add', '--all');
    await git('commit', '--quiet', '--message', 'a module and its test');
    return await run({ root, cacheRoot, commit: await git('rev-parse', 'HEAD'), git });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/** A run of the test over `test` on disk, entering the module over `source`, labelled with `commit`. */
function recording(source: string, test: string, commit: string, complete = true): TestCoverage {
  return {
    version: 3,
    instrumentation: 'fixture-instrumentation',
    commit,
    tests: [{ file: TEST, complete, preconditions: [{ name: TEST, digest: digestString(test) }] }],
    modules: [
      {
        file: SOURCE,
        sourceDigest: digestString(source),
        instrumented: true,
        blocks: [
          { ordinal: 0, kind: 'module', digest: 'block:two', name: '', path: 'module', startLine: 1, endLine: 3, source: true, testFiles: [TEST] },
          { ordinal: 1, kind: 'function', owner: 0, digest: 'block:body', name: 'two', path: 'entry', startLine: 1, endLine: 3, source: true, testFiles: [TEST] },
        ],
      },
    ],
  };
}

/** Write both texts to disk, run the suite over them green, and land it. */
async function recordOver(at: Checkout, source: string, test: string, complete = true): Promise<string> {
  await writeFile(resolve(at.root, SOURCE), source, 'utf8');
  await writeFile(resolve(at.root, TEST), test, 'utf8');
  const coverageFile = testCoverageFile(at.root, { cacheRoot: at.cacheRoot });
  await landRun(coverageFile, recording(source, test, at.commit, complete), at.root, at.cacheRoot);
  return coverageFile;
}

/** What `variance select` asks: the diff from the recording's commit to the tree, read with the graph. */
async function select(at: Checkout, coverageFile: string, readable = (_file: string) => true) {
  const diff = (await promisify(execFile)('git', ['diff', '--no-renames', at.commit], { cwd: at.root })).stdout;
  const recorded = textAtRecording(at.root, changedLines(diff).keys());
  const relations = relationsOfFiles(await scanRelations({ root: at.root, dirs: ['.'] }));
  const { entered, readings, incomplete } = await narrowByExecution(coverageFile, diff, {
    root: at.root,
    relations,
    sourceAt: (file, commit) => (readable(file) ? recorded(file, commit) : undefined),
    keptText: keptTexts(at.root, at.cacheRoot),
    keptDigests: keptDigests(at.root, at.cacheRoot),
  });
  return { entered, readings, incomplete };
}

const SETUP = 'test/setup.ts';
const COMMITTED_SETUP = 'globalThis.ready = true;\n';
const OTHER = 'test/other.test.ts';

/**
 * Two tests declaring one setup file: `TEST` ran the edited setup text, while
 * `OTHER` was last run over the committed one and carried, as a run of one
 * file leaves the rest of the record.
 */
async function recordSetupOver(at: Checkout, setup: string): Promise<string> {
  await writeFile(resolve(at.root, SETUP), setup, 'utf8');
  await writeFile(resolve(at.root, OTHER), COMMITTED_TEST, 'utf8');
  const coverageFile = testCoverageFile(at.root, { cacheRoot: at.cacheRoot });
  const ran = (file: string, text: string) => ({
    file,
    complete: true,
    preconditions: [{ name: file, digest: digestString(COMMITTED_TEST) }, { name: SETUP, digest: digestString(text) }],
  });
  const run: TestCoverage = { ...recording(COMMITTED_SOURCE, COMMITTED_TEST, at.commit), tests: [ran(TEST, setup), ran(OTHER, COMMITTED_SETUP)] };
  await landRun(coverageFile, run, at.root, at.cacheRoot);
  return coverageFile;
}

/** The reading of a file whose text the record was taken over. */
const ranOver = (file: string) => ({ file, verdict: 'none', names: [], kept: true });

describe('a green run over a text skips it', () => {
  it('selects nothing for a test file and a module left as the run found them on a dirty tree', async () => {
    await checkout(async (at) => {
      const coverageFile = await recordOver(at, EDITED_SOURCE, EDITED_TEST);

      expect(await select(at, coverageFile)).toEqual({ entered: [], readings: [ranOver(SOURCE), ranOver(TEST)], incomplete: [] });
    });
  });

  it('selects nothing once the texts the run found are committed unchanged', async () => {
    await checkout(async (at) => {
      const coverageFile = await recordOver(at, EDITED_SOURCE, EDITED_TEST);
      await at.git('commit', '--quiet', '--all', '--message', 'the edit the run recorded over');

      expect(await select(at, coverageFile)).toEqual({ entered: [], readings: [ranOver(SOURCE), ranOver(TEST)], incomplete: [] });
    });
  });

  // A run that did not pass whole is no evidence for leaving its test out, ran over this text or not.
  it('names the test as unproven when its run over that text did not pass whole', async () => {
    await checkout(async (at) => {
      const coverageFile = await recordOver(at, COMMITTED_SOURCE, EDITED_TEST, false);

      expect((await select(at, coverageFile)).incomplete).toEqual([TEST]);
    });
  });

  // A shallow clone holds no text at the recording's commit, so the diff applies to nothing.
  it('selects the test when the text at the recording\'s commit cannot be read', async () => {
    await checkout(async (at) => {
      const coverageFile = await recordOver(at, COMMITTED_SOURCE, EDITED_TEST);

      expect((await select(at, coverageFile, (file) => file !== TEST)).entered).toEqual([TEST]);
    });
  });

  it('selects the test, and reads its file, when the file moved again after the run', async () => {
    await checkout(async (at) => {
      const coverageFile = await recordOver(at, COMMITTED_SOURCE, EDITED_TEST);
      await writeFile(resolve(at.root, TEST), EDITED_TEST.replace('two(0)', 'two(2)'), 'utf8');
      const { entered, readings } = await select(at, coverageFile);

      expect(entered).toEqual([TEST]);
      expect(readings.map((reading) => [reading.file, reading.verdict])).toEqual([[TEST, 'bodies']]);
    });
  });

  it('selects only the test that ran another text of a setup file they both declare', async () => {
    await checkout(async (at) => {
      const coverageFile = await recordSetupOver(at, 'globalThis.ready = false;\n');

      expect((await select(at, coverageFile)).entered).toEqual([OTHER]);
    });
  });
});

describe('the readings of a selection with a ran-over file', () => {
  it('keep the ran-over file in the place its reader gave it', () => {
    const readings = withRanOver(
      [
        { file: 'test/a.test.ts', verdict: 'bodies', names: [] },
        { file: 'test/b.test.ts', verdict: 'bodies', names: [] },
      ],
      new Set(['test/a.test.ts']),
    );

    expect(readings.map((reading) => [reading.file, reading.verdict])).toEqual([['test/a.test.ts', 'none'], ['test/b.test.ts', 'bodies']]);
  });
});
