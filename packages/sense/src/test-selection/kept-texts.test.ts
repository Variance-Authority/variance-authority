import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { digestString } from '../digest.js';
import { repositoryLayers } from './cache-layers.js';
import { landRun, readCommitRuns } from './commit-runs.js';
import { narrowByExecution, testCoverageFile, type FileReading, type TestCoverage } from './index.js';
import { KEPT_TEXTS, keepRecordedTexts, keepText, keptDigests, keptTexts, landedTree } from './kept-texts.js';
import { openTestCoverage } from './format-view.js';
import { encodeTestCoverage } from './format.js';
import { textAtRecording } from './recorded-text.js';

/**
 * A run is recorded by being run, so the text its rows were cut from is the
 * one on disk while the suite ran — and the commit on its label holds a
 * different one whenever the tree was dirty. These record over a real
 * repository and land the run the way a runner's teardown does, then read a
 * later change the way `variance select` does: the diff from the recording's
 * commit to the working tree, with the text at that commit as `sourceAt`.
 */

const FILE = 'src/two.ts';
const COMMITTED = [
  'export function first(value) {',
  '  return value + 1;',
  '}',
  '',
  'export function second(value) {',
  '  return value * 2;',
  '}',
  '',
].join('\n');
/** An edit that moves every line down one and changes nothing that runs. */
const NOTED = `// scratch\n${COMMITTED}`;
/** An edit to `first`'s body. */
const FIRST_EDITED = COMMITTED.replace('value + 1', 'value + 10');
/** The later change: `second`'s body, which only `second.test.ts` entered. */
const secondChanged = (text: string): string => text.replace('value * 2', 'value * 3');
const TESTS = ['test/first.test.ts', 'test/second.test.ts'];

interface Checkout {
  readonly root: string;
  readonly cacheRoot: string;
  readonly commit: string;
  readonly git: (...args: string[]) => Promise<string>;
}

async function checkout<T>(run: (at: Checkout) => Promise<T>): Promise<T> {
  const scratch = await realpath(await mkdtemp(resolve(tmpdir(), 'variance-kept-texts-')));
  const root = resolve(scratch, 'repository');
  const cacheRoot = resolve(scratch, 'cache');
  try {
    await mkdir(resolve(root, 'src'), { recursive: true });
    await writeFile(resolve(root, FILE), COMMITTED, 'utf8');
    const git = async (...args: string[]): Promise<string> =>
      (await promisify(execFile)('git', args, { cwd: root })).stdout.trim();
    await git('init', '--quiet');
    await git('config', 'user.email', 'fixture@example.invalid');
    await git('config', 'user.name', 'Fixture');
    await git('add', '--all');
    await git('commit', '--quiet', '--message', 'two functions');
    return await run({ root, cacheRoot, commit: await git('rev-parse', 'HEAD'), git });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/** A run over `text`, its rows cut from `text`'s lines, labelled with `commit`. */
function recording(text: string, commit: string | undefined): TestCoverage {
  const shift = text.split('\n').indexOf('export function first(value) {');
  const lines = text.split('\n').length - 1;
  return {
    version: 3,
    instrumentation: 'fixture-instrumentation',
    ...(commit === undefined ? {} : { commit }),
    tests: TESTS.map((file) => ({ file, complete: true, preconditions: [{ name: file, digest: `source:${file}` }] })),
    modules: [
      {
        file: FILE,
        sourceDigest: digestString(text),
        instrumented: true,
        blocks: [
          { ordinal: 0, kind: 'module', digest: 'block:two', name: '', path: 'module', startLine: 1, endLine: lines, source: true, testFiles: TESTS },
          { ordinal: 1, kind: 'function', owner: 0, digest: 'block:first', name: 'first', path: 'entry', startLine: shift + 1, endLine: shift + 3, source: true, testFiles: ['test/first.test.ts'] },
          { ordinal: 2, kind: 'function', owner: 0, digest: 'block:second', name: 'second', path: 'entry', startLine: shift + 5, endLine: shift + 7, source: true, testFiles: ['test/second.test.ts'] },
        ],
      },
    ],
  };
}

/** Run the suite over `text` on disk and land it, as a runner's teardown does. */
async function recordOver(at: Checkout, text: string, labelled = true): Promise<string> {
  await writeFile(resolve(at.root, FILE), text, 'utf8');
  const coverageFile = testCoverageFile(at.root, { cacheRoot: at.cacheRoot });
  await landRun(coverageFile, recording(text, labelled ? at.commit : undefined), at.root, at.cacheRoot);
  return coverageFile;
}

/** What `variance select` reads: the diff from the recording's commit, and the text at it. */
async function select(at: Checkout, coverageFile: string, root = at.root): Promise<{ entered: readonly string[]; stale: readonly string[] }> {
  const diff = (await promisify(execFile)('git', ['diff', '--no-renames', at.commit], { cwd: root })).stdout;
  const { entered, stale } = await narrowByExecution(coverageFile, diff, {
    sourceAt: textAtRecording(root, [FILE]),
    keptText: keptTexts(root, at.cacheRoot),
  });
  return { entered, stale };
}

/** What the same selection says about how it read each changed file. */
async function readingsOf(at: Checkout, coverageFile: string): Promise<readonly FileReading[] | undefined> {
  const diff = (await promisify(execFile)('git', ['diff', '--no-renames', at.commit], { cwd: at.root })).stdout;
  const { readings } = await narrowByExecution(coverageFile, diff, {
    sourceAt: textAtRecording(at.root, [FILE]),
    keptText: keptTexts(at.root, at.cacheRoot),
  });
  return readings;
}

describe('a run recorded over an edit keeps the text it ran over', () => {
  it('reads a change against a clean-tree recording by its regions, and keeps nothing', async () => {
    await checkout(async (at) => {
      const coverageFile = await recordOver(at, COMMITTED);
      await writeFile(resolve(at.root, FILE), secondChanged(COMMITTED), 'utf8');

      expect(await keepRecordedTexts(await landedTree(at.root, at.cacheRoot), openTestCoverage(encodeTestCoverage(recording(COMMITTED, at.commit))))).toEqual([]);
      expect(await select(at, coverageFile)).toEqual({ entered: ['test/second.test.ts'], stale: [] });
    });
  });

  it('charges a module whole when the recording names no commit, because no text can be checked', async () => {
    await checkout(async (at) => {
      const coverageFile = await recordOver(at, NOTED, false);
      await writeFile(resolve(at.root, FILE), secondChanged(COMMITTED), 'utf8');

      expect(await select(at, coverageFile)).toEqual({ entered: TESTS, stale: [FILE] });
    });
  });

  it('reads a change after the edit is reverted as the diff from the text the tests ran over', async () => {
    // The recorded edit moved every line and changed nothing that runs, so
    // reverting it is no change to any function; the later edit to `second` is.
    await checkout(async (at) => {
      const coverageFile = await recordOver(at, NOTED);
      await writeFile(resolve(at.root, FILE), secondChanged(COMMITTED), 'utf8');

      expect(await select(at, coverageFile)).toEqual({ entered: ['test/second.test.ts'], stale: [] });
    });
  });

  it('reads a change after the edit is committed from the text the tests ran over, not the commit before it', async () => {
    await checkout(async (at) => {
      const coverageFile = await recordOver(at, FIRST_EDITED);
      await at.git('commit', '--quiet', '--all', '--message', 'the edit the run recorded over');
      await writeFile(resolve(at.root, FILE), secondChanged(FIRST_EDITED), 'utf8');

      expect(await select(at, coverageFile)).toEqual({ entered: ['test/second.test.ts'], stale: [] });
    });
  });

  it('selects nobody for a diff that arrives at the text the tests ran over, and says the tests ran it', async () => {
    await checkout(async (at) => {
      const coverageFile = await recordOver(at, FIRST_EDITED);

      expect(await select(at, coverageFile)).toEqual({ entered: [], stale: [] });
      // The parser was never asked: the reading is the kept text's, not a
      // verdict that the runtime text is equal.
      expect(await readingsOf(at, coverageFile)).toEqual([{ file: FILE, verdict: 'none', names: [], kept: true }]);
    });
  });

  it('charges the module whole, and names it, when the kept text is gone', async () => {
    await checkout(async (at) => {
      const coverageFile = await recordOver(at, NOTED);
      await rm(resolve(repositoryLayers(at.root, at.cacheRoot).top, KEPT_TEXTS), { recursive: true, force: true });
      await writeFile(resolve(at.root, FILE), secondChanged(COMMITTED), 'utf8');

      expect(await select(at, coverageFile)).toEqual({ entered: TESTS, stale: [FILE] });
    });
  });

  it('keeps nothing for a file edited again after the run, because the text on disk is not the one recorded', async () => {
    await checkout(async (at) => {
      await writeFile(resolve(at.root, FILE), secondChanged(NOTED), 'utf8');
      const record = openTestCoverage(encodeTestCoverage(recording(NOTED, at.commit)));

      expect(await keepRecordedTexts(await landedTree(at.root, at.cacheRoot), record)).toEqual([]);
      expect(keptTexts(at.root, at.cacheRoot)(digestString(NOTED))).toBeUndefined();
    });
  });

  it('answers nothing for a stored text that does not hash to the digest it is filed under', async () => {
    await checkout(async (at) => {
      await recordOver(at, NOTED);
      const digest = digestString(NOTED);
      const stored = resolve(repositoryLayers(at.root, at.cacheRoot).top, KEPT_TEXTS, digest.replace(/^[^:]+:/u, ''));
      expect(keptTexts(at.root, at.cacheRoot)(digest)).toBe(NOTED);

      await writeFile(stored, COMMITTED, 'utf8');
      expect(keptTexts(at.root, at.cacheRoot)(digest)).toBeUndefined();
    });
  });

  it('writes a text once, and answers that it is kept every time it is asked to keep it', async () => {
    const top = await realpath(await mkdtemp(resolve(tmpdir(), 'variance-keep-text-')));
    try {
      const digest = digestString(NOTED);
      const stored = resolve(top, KEPT_TEXTS, digest.replace(/^[^:]+:/u, ''));
      expect(await keepText(top, digest, NOTED)).toBe(true);
      // Dated a whole second in the past, so a second write would show as a newer date.
      const past = new Date(Math.floor(Date.now() / 1000) * 1000 - 60_000);
      await utimes(stored, past, past);

      expect(await keepText(top, digest, NOTED)).toBe(true);

      expect((await stat(stored)).mtimeMs).toBe(past.getTime());
      expect(await readFile(stored, 'utf8')).toBe(NOTED);
    } finally {
      await rm(top, { recursive: true, force: true });
    }
  });

  it('serves a worktree reading the primary checkout\'s recording the text the primary kept', async () => {
    await checkout(async (at) => {
      const coverageFile = await recordOver(at, NOTED);
      const worktree = resolve(at.root, '..', 'worktree');
      await at.git('worktree', 'add', '--quiet', '--detach', worktree, at.commit);
      await writeFile(resolve(worktree, FILE), secondChanged(COMMITTED), 'utf8');

      // Its own layer holds nothing; the primary's, beneath it, holds the text.
      const { top, base } = repositoryLayers(worktree, at.cacheRoot);
      expect(top).not.toBe(base);
      expect(await select(at, coverageFile, worktree)).toEqual({ entered: ['test/second.test.ts'], stale: [] });
    });
  });

  // Git keeps an untracked cache for a checkout that turns it on, so that
  // asking what moved does not read every directory again; it answers the
  // question only in the shape the scan asks it (`tree.ts`). Asked in any other,
  // every landing pays a walk of the whole checkout.
  it('asks git what moved in the shape its untracked cache answers, so a landing does not walk every file', async () => {
    await checkout(async (at) => {
      const files = 200;
      for (let file = 0; file < files; file += 1) await writeFile(resolve(at.root, 'src', `f${file}.ts`), `${file}\n`, 'utf8');
      await at.git('add', '--all');
      await at.git('commit', '--quiet', '--message', 'a directory of files');
      await at.git('config', 'core.untrackedCache', 'true');
      const commit = await at.git('rev-parse', 'HEAD');
      await writeFile(resolve(at.root, FILE), NOTED, 'utf8');
      // Older than the index, so git does not distrust the cache it is about to write.
      const past = new Date(Date.now() - 60_000);
      for (const directory of [at.root, resolve(at.root, 'src')]) await utimes(directory, past, past);
      await at.git('status', '--porcelain');
      const trace = resolve(at.cacheRoot, 'git-trace');
      await mkdir(at.cacheRoot, { recursive: true });

      vi.stubEnv('GIT_TRACE2_PERF', trace);
      let kept: readonly string[];
      try {
        kept = await keepRecordedTexts(await landedTree(at.root, at.cacheRoot), openTestCoverage(encodeTestCoverage(recording(NOTED, commit))));
      } finally {
        vi.unstubAllEnvs();
      }

      expect(kept).toEqual([digestString(NOTED)]);
      const visited = [...(await readFile(trace, 'utf8')).matchAll(/paths-visited:(\d+)/gu)].map(([, count]) => Number(count));
      expect(visited.length).toBeGreaterThan(0);
      expect(Math.max(...visited)).toBeLessThan(files);
    });
  });
});

/**
 * An edit the run recorded over, then undone: the diff from the commit names
 * nothing, and the record's kept text says the tree moved back under the tests
 * that ran the edit.
 */
describe('the runs record names the texts its runs ran over', () => {
  it('names each edited module by the digest of the text the run ran over, and none for a clean tree', async () => {
    await checkout(async (at) => {
      const clean = await recordOver(at, COMMITTED);
      expect((await readCommitRuns(clean))?.landings?.map((landing) => landing.texts)).toEqual([{}]);
    });
    await checkout(async (at) => {
      const edited = await recordOver(at, FIRST_EDITED);
      expect((await readCommitRuns(edited))?.landings?.map((landing) => landing.texts)).toEqual([{ [FILE]: digestString(FIRST_EDITED) }]);
    });
  });

  it('names an edited module the run did not instrument, and an edited precondition, by the digests the run recorded', async () => {
    await checkout(async (at) => {
      await writeFile(resolve(at.root, 'src/plain.ts'), 'export const plain = 1;\n', 'utf8');
      await writeFile(resolve(at.root, 'src/fixture.json'), '{"value":1}\n', 'utf8');
      await writeFile(resolve(at.root, 'src/clean.json'), '{"value":0}\n', 'utf8');
      await at.git('add', '--all');
      await at.git('commit', '--quiet', '--message', 'a plain module and two fixtures');
      const commit = await at.git('rev-parse', 'HEAD');
      await writeFile(resolve(at.root, 'src/plain.ts'), 'export const plain = 2;\n', 'utf8');
      await writeFile(resolve(at.root, 'src/fixture.json'), '{"value":2}\n', 'utf8');
      const run = recording(COMMITTED, commit);
      const current: TestCoverage = {
        ...run,
        tests: run.tests.map((test) => ({
          ...test,
          preconditions: [...test.preconditions, { name: 'src/fixture.json', digest: 'fixture:edited' }, { name: 'src/clean.json', digest: 'fixture:clean' }],
        })),
        modules: [...run.modules, { file: 'src/plain.ts', sourceDigest: 'plain:edited', instrumented: false, blocks: [] }],
      };
      const coverageFile = testCoverageFile(at.root, { cacheRoot: at.cacheRoot });
      await landRun(coverageFile, current, at.root, at.cacheRoot);
      expect((await readCommitRuns(coverageFile))?.landings?.map((landing) => landing.texts))
        .toEqual([{ 'src/fixture.json': 'fixture:edited', 'src/plain.ts': 'plain:edited' }]);
    });
  });

  it('carries the texts with the tests a run at another commit did not observe', async () => {
    await checkout(async (at) => {
      const coverageFile = await recordOver(at, FIRST_EDITED);
      const before = (await readCommitRuns(coverageFile))!;
      await writeFile(resolve(at.root, FILE), COMMITTED, 'utf8');
      await writeFile(resolve(at.root, 'README.md'), 'another commit\n', 'utf8');
      await at.git('add', '--all');
      await at.git('commit', '--quiet', '--message', 'another commit');
      const next = await at.git('rev-parse', 'HEAD');
      const run = recording(COMMITTED, next);
      const second = {
        ...run,
        tests: run.tests.filter((test) => test.file === TESTS[1]),
        modules: run.modules.map((module) => ({
          ...module,
          blocks: module.blocks.map((block) => ({ ...block, testFiles: block.testFiles.filter((file) => file === TESTS[1]) })),
        })),
      };
      await landRun(coverageFile, second, at.root, at.cacheRoot);
      const after = (await readCommitRuns(coverageFile))!;
      expect(after.landings?.map((landing) => landing.texts)).toEqual([{}]);
      expect(after.standing).toEqual([
        { commit: at.commit, files: [TESTS[0]], first: before.first, latest: before.latest, runs: 1, installed: {}, texts: { [FILE]: digestString(FIRST_EDITED) } },
      ]);
    });
  });
});

describe('an undone edit', () => {
  async function undone(
    at: Checkout,
    ignore?: readonly string[],
    keptText = keptTexts(at.root, at.cacheRoot),
  ): Promise<readonly string[]> {
    const coverageFile = await recordOver(at, FIRST_EDITED);
    await writeFile(resolve(at.root, FILE), COMMITTED, 'utf8');
    const diff = (await promisify(execFile)('git', ['diff', '--no-renames', at.commit], { cwd: at.root })).stdout;
    const { entered } = await narrowByExecution(coverageFile, diff, {
      sourceAt: textAtRecording(at.root, [FILE]),
      keptText,
      keptDigests: keptDigests(at.root, at.cacheRoot),
      ...(ignore === undefined ? {} : { ignore }),
    });
    return entered;
  }

  it('selects the tests that ran the edit', async () => {
    await checkout(async (at) => {
      expect(await undone(at)).toEqual(['test/first.test.ts']);
    });
  });

  it('selects nothing in a suite that ignores the file', async () => {
    await checkout(async (at) => {
      expect(await undone(at, ['src/**'])).toEqual([]);
    });
  });

  it('selects every test that loaded the file when the text it ran over cannot be read back', async () => {
    await checkout(async (at) => {
      // The rows were cut from a text nobody holds: stale, and charged whole.
      expect(await undone(at, undefined, () => undefined)).toEqual(['test/first.test.ts', 'test/second.test.ts']);
    });
  });
});
