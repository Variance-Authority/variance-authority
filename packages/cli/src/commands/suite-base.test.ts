import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { publishLine } from '@variance-authority/core/share';
import {
  commitRunsFile,
  declaredSuites,
  readCommitRuns,
  seedTestCoverage,
  testCoverageFile,
} from '@variance-authority/sense/test-selection';
import { parseArgs } from '../bin.js';
import type { Config } from '../config.js';
import { frame, suiteEntry } from '../share-entries.js';
import { lineCellOf, type Env } from '../share-lines.js';
import { EXIT_CLEAN, EXIT_OPERATOR } from '../exit.js';
import { MAINLINE_REUSE_MS, mainlineBase, mainlineMissed, mainlineRead } from './mainline-base.js';
import { DISCOUNTS, GIT_SHARE, PUSH, gitPublished, recordIn, selectedIn } from './mainline-fixture.js';
import { layMainline, suiteBase } from './suite-base.js';
import { publishSuite, suiteShare, suiteShareLines } from './suite-share.js';

/**
 * The record a checkout measures from, in a real repository whose `origin` is
 * a bare repository carrying `refs/variance/mainline/main`, the way CI leaves
 * GitHub after a push to `main`: this checkout's own, else the mainline's,
 * else the primary checkout's, with the reason the mainline's was passed over.
 */

const run = promisify(execFile);
const LOCAL: Env = {};
let home: string;
const cwd = process.cwd();

beforeEach(async () => {
  // Real, because git records a worktree's primary checkout by its real path.
  home = await realpath(await mkdtemp(join(tmpdir(), 'variance-suite-base-')));
});

afterEach(async () => {
  process.chdir(cwd);
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

/** The CI checkout, with its cache at `ci-cache`: see `gitPublished`. */
const mainline = (options: { readonly publish?: boolean } = {}) => gitPublished(home, options);

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

  it('is refused for a record whose run did not run the whole suite, rather than published as the base', async () => {
    const { ci, origin, first } = await mainline({ publish: false });
    const own = testCoverageFile(ci, { suite: 'unit' });
    const runs = { commit: first, first: '', latest: '', runs: 1, files: ['test/total.test.ts'], standing: [{ commit: 'c'.repeat(40), files: ['test/other.test.ts'] }] };
    await writeFile(commitRunsFile(own), JSON.stringify(runs));

    expect(await publishSuite(ci, 'unit', { env: PUSH })).toEqual({
      none: `suite-v1/unit is left out: its record at ${own} is not a whole run: 1 test file(s) git holds at ${first} last ran before it, test/other.test.ts among them; the runner was not asked which files it collects, so each one git holds counts: pass \`--collected\``,
    });
    expect(await git(home, 'ls-remote', origin, 'refs/variance/mainline/main')).toBe('');
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
    // The runs record the publishing run carried lies beside it, and the worktree's own layer is left empty.
    expect(await readCommitRuns(base.file)).toMatchObject({ commit: first, standing: [] });
    expect(existsSync(testCoverageFile(worktree, { suite: 'unit' }))).toBe(false);
  });

  it('is laid into a fresh CI checkout\'s own layer with the runs record the mainline carried, and never over a record it has', async () => {
    const { origin } = await mainline();
    const fresh = join(home, 'fresh');
    await git(home, 'clone', '--quiet', origin, fresh);
    cacheOf('fresh-cache');
    const base = await suiteBase(fresh, { env: LOCAL });
    if (base.from !== 'mainline') throw new Error(`expected the mainline's record, read ${JSON.stringify(base)}`);

    const laid = await layMainline(fresh, base.mainline);

    const own = testCoverageFile(fresh, { suite: 'unit' });
    expect(laid).toBe(own);
    expect(await readFile(own)).toEqual(await readFile(base.file));
    expect(existsSync(`${own}.cases.bin`)).toBe(true);
    expect(await readFile(commitRunsFile(own))).toEqual(await readFile(join(dirname(base.file), 'coverage.runs.json')));
    expect(await suiteBase(fresh, { env: LOCAL })).toEqual({ from: 'own', suite: 'unit', file: own });
    expect(await layMainline(fresh, base.mainline)).toBeUndefined();
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
    const cell = await lineCellOf({ share: GIT_SHARE, cacheRoot: join(home, 'ci-cache') } as unknown as Config, { cwd: ci });
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

describe('every reader of a worktree that has run nothing starts from the same record', () => {
  it('a runner seam lays the mainline record last fetched on this machine as the worktree\'s first, not the primary checkout\'s', async () => {
    const ci = await mainline();
    const { worktree, record } = await laptop(ci.origin, ci.first);
    const base = await suiteBase(worktree, { env: LOCAL });
    if (base.from !== 'mainline') throw new Error(`expected the mainline's record, read ${JSON.stringify(base)}`);
    const own = testCoverageFile(worktree, { suite: 'unit' });

    // What `yarn test`'s seam does before it lands the run it made.
    const seeded = await seedTestCoverage(own, worktree);

    expect(seeded).toMatchObject({ from: 'mainline', record: { mainline: 'main', commit: ci.first } });
    expect(await readFile(own)).toEqual(ci.record);
    expect(await readFile(own)).not.toEqual(record);
    expect(await readFile(commitRunsFile(own))).toEqual(await readFile(commitRunsFile(base.file)));
  });

  it('`variance select` reads the mainline\'s record, and says so, where the primary checkout holds one too', async () => {
    const { origin, first } = await mainline();
    const { worktree } = await laptop(origin, first);
    await writeFile(join(worktree, 'src/total.ts'), 'export const changed = true;\n');

    const { err } = await selectedIn(worktree);

    expect(err).toContain(`record of "unit": read from mainline main, published at ${first}`);
  });

  it('reuses the record it fetched for ten minutes, and past that keeps it when the remote does not answer', async () => {
    const { origin, first } = await mainline();
    const { worktree } = await laptop(origin, first);
    expect(await suiteBase(worktree, { env: LOCAL })).toMatchObject({ from: 'mainline' });
    await git(worktree, 'remote', 'set-url', 'origin', join(home, 'nowhere.git'));

    expect(await suiteBase(worktree, { env: LOCAL })).toMatchObject({ from: 'mainline', mainline: { commit: first, earlier: { reused: true } } });
    const declared = declaredSuites(worktree)?.find((one) => one.name === 'unit');
    const later = await mainlineBase(worktree, declared, { env: LOCAL, now: Date.now() + MAINLINE_REUSE_MS + 60_000 });
    expect(later).toMatchObject({ commit: first, earlier: { unanswered: { kind: 'unreachable' } } });
  });
});

describe('a mainline publish counts a whole run against what the runner collects', () => {
  it('passes over a file that last ran at an older commit when the runner no longer collects it', async () => {
    const { ci, origin, first } = await mainline({ publish: false });
    const own = testCoverageFile(ci, { suite: 'unit' });
    const runs = { commit: first, first: '', latest: '', runs: 1, files: ['test/total.test.ts'], standing: [{ commit: 'c'.repeat(40), files: ['test/other.test.ts'] }] };
    await writeFile(commitRunsFile(own), JSON.stringify(runs));
    const collected = join(home, 'collected.txt');
    await writeFile(collected, 'test/total.test.ts\n');

    expect(await publishSuite(ci, 'unit', { env: PUSH }, { collected })).toMatchObject({ published: { written: [suiteEntry('unit')] } });
    expect(await git(home, 'ls-remote', origin, 'refs/variance/mainline/main')).toMatch(/refs\/variance\/mainline\/main$/u);
  });

  it('counts a file standing at the publish commit itself as run there', async () => {
    const { ci, first } = await mainline({ publish: false });
    const own = testCoverageFile(ci, { suite: 'unit' });
    const runs = { commit: first, first: '', latest: '', runs: 1, files: ['test/total.test.ts'], standing: [{ commit: first, files: ['test/other.test.ts'] }] };
    await writeFile(commitRunsFile(own), JSON.stringify(runs));

    expect(await publishSuite(ci, 'unit', { env: PUSH })).toMatchObject({ published: { written: [suiteEntry('unit')] } });
  });

  it('fails the command when a mainline publish writes nothing, and not when a branch\'s does', async () => {
    const { ci } = await mainline({ publish: false });
    await git(ci, 'commit', '--quiet', '--allow-empty', '-m', 'second');

    const refused = await suiteShare(ci, { suite: 'unit', publish: true }, { env: PUSH });
    expect(refused.exit).toBe(EXIT_OPERATOR);
    expect(refused.lines.join('\n')).toContain('was recorded at');
    const branch = { ...PUSH, GITHUB_REF_NAME: 'feature' };
    expect((await suiteShare(ci, { suite: 'unit', publish: true }, { env: branch })).exit).toBe(EXIT_CLEAN);
  });

  it('refuses `--collected` anywhere but beside `--suite` and `--publish`', () => {
    expect(() => parseArgs(['share', '--suite', 'unit', '--collected', 'files.txt'])).toThrow(
      '`--collected` is for `share --suite <name> --publish`, which counts a whole run against it',
    );
    expect(parseArgs(['share', '--suite', 'unit', '--publish', '--collected', 'files.txt'])).toMatchObject({ collected: 'files.txt' });
  });
});

it.todo(
  'a push to main publishes suite-v1/unit to refs/variance/mainline/main on GitHub, and the next pull request\'s `yarn test:since` reads it — needs check.yml running on the repository with `contents: write` on its publish job',
);
