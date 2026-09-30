import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { publishLine } from '@variance-authority/core/share';
import {
  readCommitRuns,
  seedTestCoverage,
  testCoverageFile,
} from '@variance-authority/sense/test-selection';
import { parseArgs } from '../bin.js';
import type { Config } from '../config.js';
import { frame, suiteEntry } from '../share-entries.js';
import { lineCellOf, type Env } from '../share-lines.js';
import { mainlineMissed, mainlineRead } from './mainline-base.js';
import { BEFORE, DISCOUNTS, PUSH, recordIn } from './mainline-fixture.js';
import { layMainline, mainlineRuns, suiteBase } from './suite-base.js';
import { publishSuite, suiteShareLines } from './suite-share.js';

/**
 * The record a checkout measures from, in a real repository whose `origin` is
 * a bare repository carrying `refs/variance/mainline/main`, the way CI leaves
 * GitHub after a push to `main`: this checkout's own, else the mainline's,
 * else the primary checkout's, with the reason the mainline's was passed over.
 */

const run = promisify(execFile);
const LOCAL: Env = {};
const SHARE = { kind: 'git', mainlines: ['main'] } as const;
let home: string;

beforeEach(async () => {
  // Real, because git records a worktree's primary checkout by its real path.
  home = await realpath(await mkdtemp(join(tmpdir(), 'variance-suite-base-')));
});

afterEach(async () => {
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
  await rm(home, { recursive: true, force: true });
});

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await run('git', args, { cwd })).stdout.trim();
}

/** Point every cache read and write in this process at `name` under the test's directory. */
function cacheOf(name: string): string {
  const cache = join(home, name);
  process.env['VARIANCE_AUTHORITY_CACHE'] = cache;
  return cache;
}

/**
 * The CI checkout: `unit` given to a git share, one commit pushed to a bare
 * `origin`, and the record CI made there, in which only `total.test.ts` runs
 * `applyDiscount`. Published with a push's environment unless told not to.
 */
async function mainline(options: { readonly publish?: boolean } = {}): Promise<{ ci: string; origin: string; first: string; record: Buffer }> {
  const origin = join(home, 'origin.git');
  const ci = join(home, 'ci');
  await git(home, 'init', '--quiet', '--bare', '--initial-branch', 'main', origin);
  await git(home, 'init', '--quiet', '--initial-branch', 'main', ci);
  await git(ci, 'config', 'user.email', 'fixture@example.test');
  await git(ci, 'config', 'user.name', 'Fixture');
  await mkdir(join(ci, 'src'));
  await mkdir(join(ci, 'test'));
  await writeFile(join(ci, 'src/total.ts'), BEFORE);
  await writeFile(join(ci, 'test/total.test.ts'), "it('discounts', () => {});\n");
  await writeFile(join(ci, 'test/other.test.ts'), "it('stands alone', () => {});\n");
  await writeFile(join(ci, 'variance.config.json'), JSON.stringify({ suites: { unit: { kind: 'unit', carry: 'share' } }, share: SHARE }));
  await git(ci, 'add', '-A');
  await git(ci, 'commit', '--quiet', '-m', 'first');
  const first = await git(ci, 'rev-parse', 'HEAD');
  await git(ci, 'remote', 'add', 'origin', origin);
  await git(ci, 'push', '--quiet', 'origin', 'main');
  await git(ci, 'fetch', '--quiet', 'origin');

  cacheOf('ci-cache');
  await recordIn(ci, first, ['test/total.test.ts'], [DISCOUNTS]);
  const record = await readFile(testCoverageFile(ci, { suite: 'unit' }));
  if (options.publish !== false) {
    const done = await publishSuite(ci, 'unit', { env: PUSH });
    expect(done).toMatchObject({ line: { kind: 'mainline', name: 'main' }, published: { written: [suiteEntry('unit')] } });
  }
  return { ci, origin, first, record };
}

/**
 * A laptop: a clone of `origin` whose primary checkout recorded at `first` a
 * record the mainline's is not (only `other.test.ts` runs `applyDiscount`), and
 * a worktree of it that has run nothing.
 */
async function laptop(origin: string, first: string): Promise<{ primary: string; worktree: string; cache: string; record: Buffer }> {
  const primary = join(home, 'clone');
  await git(home, 'clone', '--quiet', origin, primary);
  const cache = cacheOf('laptop-cache');
  await recordIn(primary, first, ['test/other.test.ts'], [DISCOUNTS]);
  const record = await readFile(testCoverageFile(primary, { suite: 'unit' }));
  const worktree = join(home, 'feature');
  await git(primary, 'worktree', 'add', '--quiet', '--detach', worktree);
  return { primary, worktree, cache, record };
}

describe('a published record reaches the remote', () => {
  it('as refs/variance/mainline/main on origin, after a push to main', async () => {
    const { origin } = await mainline();
    expect(await git(home, 'ls-remote', origin, 'refs/variance/mainline/main')).toMatch(/refs\/variance\/mainline\/main$/u);
  });

  it('is refused for a record made at another commit, rather than published under this one', async () => {
    const { ci } = await mainline({ publish: false });
    await git(ci, 'commit', '--quiet', '--allow-empty', '-m', 'second');
    expect(await publishSuite(ci, 'unit', { env: PUSH })).toMatchObject({ none: expect.stringContaining('was recorded at') });
  });
});

describe('the record a worktree that has run nothing measures from', () => {
  it('is the mainline\'s, ahead of the primary checkout\'s, named with the mainline and its distance', async () => {
    const ci = await mainline();
    const { worktree, cache, record } = await laptop(ci.origin, ci.first);
    const first = ci.first;

    const base = await suiteBase(worktree, { env: LOCAL });

    expect(base).toMatchObject({ from: 'mainline', suite: 'unit', mainline: { mainline: 'main', commit: first, distance: 0 } });
    expect(base.file).toBe(join(cache, 'share', 'read', 'unit', first, 'coverage.bin'));
    expect(await readFile(base.file)).toEqual(ci.record);
    expect(ci.record).not.toEqual(record);
    const said = `record of "unit": read from mainline main, published at ${first}, at the merge base with this checkout; kept at ${base.file}`;
    if (base.from === 'mainline') expect(mainlineRead(base.mainline)).toBe(said);
    expect(await suiteShareLines(worktree, { suite: 'unit', publish: false }, { env: LOCAL })).toEqual([`${said}.`]);
  });

  it('is laid into the worktree\'s own layer before a run, as one full run at the published commit, and the primary\'s is then not copied up', async () => {
    const { origin, first } = await mainline();
    const { worktree } = await laptop(origin, first);
    const base = await suiteBase(worktree, { env: LOCAL });
    if (base.from !== 'mainline') throw new Error(`expected the mainline's record, read ${JSON.stringify(base)}`);

    const laid = await layMainline(worktree, base.mainline);

    const own = testCoverageFile(worktree, { suite: 'unit' });
    expect(laid).toBe(own);
    expect(await readFile(own)).toEqual(await readFile(base.file));
    expect(existsSync(`${own}.cases.bin`)).toBe(true);
    const runs = { commit: first, runs: 1, files: ['test/other.test.ts', 'test/total.test.ts'], standing: [] };
    expect(await readCommitRuns(own)).toMatchObject(runs);
    expect(await mainlineRuns(base.mainline)).toMatchObject(runs);
    // What the runner does before its first run in a worktree: a record is
    // there now, so nothing is copied over it.
    await seedTestCoverage(own, worktree);
    expect(await readFile(own)).toEqual(await readFile(base.file));
    expect(await suiteBase(worktree, { env: LOCAL })).toEqual({ from: 'own', suite: 'unit', file: own });
    // A second lay finds this checkout's own record and leaves it.
    expect(await layMainline(worktree, base.mainline)).toBeUndefined();
  });

  it('is the worktree\'s own once it has one, and the mainline is not asked', async () => {
    const { origin, first } = await mainline();
    const { worktree } = await laptop(origin, first);
    await recordIn(worktree, first, ['test/other.test.ts'], [DISCOUNTS]);
    // A remote that does not exist: asking it would be a miss, and there is none.
    await git(worktree, 'remote', 'set-url', 'origin', join(home, 'nowhere.git'));

    expect(await suiteBase(worktree, { env: LOCAL })).toEqual({
      from: 'own',
      suite: 'unit',
      file: testCoverageFile(worktree, { suite: 'unit' }),
    });
  });
});

describe('the primary checkout\'s record is the offline fallback, and says why', () => {
  it('when the remote cannot be reached', async () => {
    const { origin, first } = await mainline();
    const { primary, worktree } = await laptop(origin, first);
    await git(worktree, 'remote', 'set-url', 'origin', join(home, 'nowhere.git'));

    const base = await suiteBase(worktree, { env: LOCAL });

    expect(base).toMatchObject({ from: 'primary', suite: 'unit', file: testCoverageFile(primary, { suite: 'unit' }) });
    expect(base).toMatchObject({ missed: { mainline: 'main', miss: { kind: 'unreachable' } } });
    if (!('missed' in base) || base.missed === undefined) throw new Error('the miss was not carried');
    expect(mainlineMissed(base.missed)).toMatch(/^record of "unit": the mainline's was not read; mainline main: /u);
  });

  it('when the remote carries no refs/variance/mainline/main', async () => {
    const { origin, first } = await mainline({ publish: false });
    const { primary, worktree } = await laptop(origin, first);

    const base = await suiteBase(worktree, { env: LOCAL });

    expect(base).toMatchObject({ from: 'primary', file: testCoverageFile(primary, { suite: 'unit' }), missed: { miss: { kind: 'absent' } } });
    if (!('missed' in base) || base.missed === undefined) throw new Error('the miss was not carried');
    expect(mainlineMissed(base.missed)).toBe('record of "unit": the share has none either; mainline main: nothing is published there');
  });

  it('when the entry the mainline holds does not read', async () => {
    const { ci, origin, first } = await mainline({ publish: false });
    const cell = await lineCellOf({ share: SHARE, cacheRoot: join(home, 'ci-cache') } as unknown as Config, { cwd: ci });
    if (cell === undefined || !('load' in cell)) throw new Error(`no line cell: ${JSON.stringify(cell)}`);
    await publishLine(cell, { kind: 'mainline', name: 'main' }, [
      { name: suiteEntry('unit'), commit: first, bytes: frame([['coverage.bin', new Uint8Array([1, 2, 3, 4])]]) },
    ], { descends: async () => undefined, image: async (digest) => { throw new Error(`no image ${digest}`); } });
    const { primary, worktree } = await laptop(origin, first);

    const base = await suiteBase(worktree, { env: LOCAL });

    expect(base).toMatchObject({ from: 'primary', file: testCoverageFile(primary, { suite: 'unit' }), missed: { miss: { kind: 'unreadable' } } });
  });

  it('and when there is no primary record either, nothing is read and the miss is still said', async () => {
    const { origin, first } = await mainline({ publish: false });
    const { primary, worktree } = await laptop(origin, first);
    await rm(testCoverageFile(primary, { suite: 'unit' }));

    expect(await suiteBase(worktree, { env: LOCAL })).toMatchObject({
      from: 'none',
      file: testCoverageFile(worktree, { suite: 'unit' }),
      missed: { miss: { kind: 'absent' } },
    });
  });
});

describe('`variance share --suite unit`', () => {
  it('publishes the record alone, and says so the way `share --publish` does', async () => {
    const { ci } = await mainline({ publish: false });
    const lines = await suiteShareLines(ci, { suite: 'unit', publish: true }, { env: PUSH });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^wrote suite-v1\/unit to mainline main in /u);
  });

  it('says nothing was published when this checkout holds no record at this commit', async () => {
    const { ci } = await mainline({ publish: false });
    await rm(testCoverageFile(ci, { suite: 'unit' }));
    expect(await suiteShareLines(ci, { suite: 'unit', publish: true }, { env: PUSH })).toEqual([
      'nothing published: this checkout holds no record of "unit".',
    ]);
  });

  it("refuses the other form's inputs beside it", () => {
    expect(() => parseArgs(['share', '--suite', 'unit', '--config', 'web.json'])).toThrow(
      '`share --suite` reads the suite and its share from the root variance.config.json, so it takes no `--config`',
    );
    expect(() => parseArgs(['share', '--suite', 'unit', '--publish', 'report.json'])).toThrow(/so it takes no report$/u);
    expect(parseArgs(['share', '--suite', 'unit', '--publish'])).toMatchObject({ command: 'share', suite: 'unit', publish: true });
  });
});

it.todo(
  'a push to main publishes suite-v1/unit to refs/variance/mainline/main on GitHub, and the next pull request\'s `yarn test:since` reads it — needs check.yml running on the repository with `contents: write` on its publish job',
);
