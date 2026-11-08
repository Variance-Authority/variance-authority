import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { publishLine } from '@variance-authority/core/share';
import {
  declaredSuites,
  keepsCases,
  readCommitRuns,
  seedTestCoverage,
  testCoverageFile,
  withIndexLock,
} from '@variance-authority/sense/test-selection';
import { instrumentationId } from '@variance-authority/sense/instrument';
import { variancePrecondition } from '@variance-authority/sense/precondition';
import { parseArgs } from '../bin.js';
import type { Config } from '../config.js';
import { frame, suiteEntry } from '../share-entries.js';
import { lineCellOf, type Env } from '../share-lines.js';
import { EXIT_CLEAN } from '../exit.js';
import { mainlineBase, mainlineMissed, mainlineRead } from './mainline-base.js';
import { DISCOUNTS, GIT_SHARE, gitPublished, recordIn, selectedIn } from './mainline-fixture.js';
import { layMainline, mainlinePassedOver, suiteBase } from './suite-base.js';
import { runRootShare } from './share-suites.js';
import { suiteShare, suiteShareLines } from './suite-share.js';
import { suiteTimes } from './suite-times.js';

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
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await run('git', args, { cwd })).stdout.trim();
}

/** Point every cache read and write in this process at `name` under the test's directory. */
function cacheOf(name: string): string {
  const cache = join(home, name);
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', cache);
  return cache;
}

/** The CI checkout, with its cache at `ci-cache`: see `gitPublished`. */
const mainline = (options: { readonly publish?: boolean; readonly instrumentation?: string } = {}) => gitPublished(home, options);

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

describe('the record a worktree that has run nothing measures from', () => {
  it('is the mainline\'s, ahead of the primary checkout\'s, named with the mainline and its distance', async () => {
    const ci = await mainline({ instrumentation: instrumentationId() });
    const { worktree, cache, record } = await laptop(ci.origin, ci.first);
    const first = ci.first;

    const base = await suiteBase(worktree, { env: LOCAL });

    expect(base).toMatchObject({ from: 'mainline', suite: 'unit', mainline: { mainline: 'main', commit: first, distance: 0 } });
    expect(base.file).toBe(join(cache, 'share', 'read', 'unit', first, 'coverage.bin'));
    expect(await readFile(base.file)).toEqual(ci.record);
    expect(ci.record).not.toEqual(record);
    const said = `record of "unit": read from mainline main, published at ${first}, at the merge base with this checkout; kept at ${base.file}`;
    if (base.from === 'mainline') expect(mainlineRead(base.mainline)).toBe(said);
    // The runs record the publishing run carried lies beside it, and the worktree's own layer is left empty.
    expect(await readCommitRuns(base.file)).toMatchObject({ commit: first, standing: [] });
    expect(existsSync(testCoverageFile(worktree, { suite: 'unit' }))).toBe(false);
    // Read by name, it is laid there, for the run the worktree makes next to select from.
    expect(await suiteShareLines(worktree, { suite: 'unit', publish: false }, { env: LOCAL })).toEqual([`${said}.`]);
    expect(await readFile(testCoverageFile(worktree, { suite: 'unit' }))).toEqual(ci.record);
  });

  it('is laid into a fresh CI checkout\'s own layer with the runs record the mainline carried as a seed, and never over a record it has', async () => {
    const { origin } = await mainline();
    const fresh = join(home, 'fresh');
    await git(home, 'clone', '--quiet', origin, fresh);
    cacheOf('fresh-cache');
    const base = await suiteBase(fresh, { env: LOCAL });
    if (base.from !== 'mainline') throw new Error(`expected the mainline's record, read ${JSON.stringify(base)}`);

    const laid = await layMainline(fresh, base.mainline, 'fixture');

    const own = testCoverageFile(fresh, { suite: 'unit' });
    expect(laid).toEqual({ laid: own });
    expect(await readFile(own)).toEqual(await readFile(base.file));
    expect(keepsCases(own)).toBe(true);
    // The mainline's runs record, as a seed: none of its runs are this checkout's, and they landed when they landed.
    const published = (await readCommitRuns(base.file))!;
    expect(await readCommitRuns(own)).toEqual({ ...published, runs: 0 });
    expect(await suiteBase(fresh, { env: LOCAL })).toEqual({
      from: 'own',
      suite: 'unit',
      file: own,
      layer: { pinned: { mainline: 'main', commit: base.mainline.commit }, ran: [] },
      repin: { repinned: false, why: 'current' },
    });
    expect(await layMainline(fresh, base.mainline, 'fixture')).toBeUndefined();
  });

  it('says so when the record is held by another writer, and lays nothing', async () => {
    const { origin } = await mainline();
    const fresh = join(home, 'fresh');
    await git(home, 'clone', '--quiet', origin, fresh);
    cacheOf('fresh-cache');
    const base = await suiteBase(fresh, { env: LOCAL });
    if (base.from !== 'mainline') throw new Error(`expected the mainline's record, read ${JSON.stringify(base)}`);
    const own = testCoverageFile(fresh, { suite: 'unit' });
    await mkdir(dirname(own), { recursive: true });
    await writeFile(`${own}.lock`, '1\n');

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    variancePrecondition('fixture', { clock: 'faked' });
    let settled = false;
    const refused = expect(layMainline(fresh, base.mainline, 'fixture')).rejects.toThrow(`another process is holding ${own}.lock`).finally(() => (settled = true));
    while (!settled) {
      vi.advanceTimersByTime(1000);
      await new Promise((turn) => setImmediate(turn));
    }
    vi.useRealTimers();
    await refused;

    expect(existsSync(own)).toBe(false);
  });

  it('is passed over, named with both probes, when the suite\'s run records under other probes than it was written under', async () => {
    const { origin } = await mainline();
    const fresh = join(home, 'fresh');
    await git(home, 'clone', '--quiet', origin, fresh);
    cacheOf('fresh-cache');
    const base = await suiteBase(fresh, { env: LOCAL });
    if (base.from !== 'mainline') throw new Error(`expected the mainline's record, read ${JSON.stringify(base)}`);
    const own = testCoverageFile(fresh, { suite: 'unit' });

    const laid = await layMainline(fresh, base.mainline, 'newer-recipe');

    // No run under `newer-recipe` could be laid over it, so the checkout keeps
    // no record: the suite has no base, and runs whole.
    expect(laid).toEqual({ passed: { suite: 'unit', file: base.file, instrumentation: 'fixture', run: 'newer-recipe' } });
    expect(existsSync(own)).toBe(false);
    if (laid === undefined || !('passed' in laid)) throw new Error('expected the record passed over');
    expect(mainlinePassedOver(laid.passed)).toBe(
      `record of "unit": the mainline's record at ${base.file} was written under the probes \`fixture\`, ` +
        'and this run records under `newer-recipe`, so no run here can be laid over it and it was not laid',
    );

    // Under the probes it was written under, it is laid.
    expect(await layMainline(fresh, base.mainline, 'fixture')).toEqual({ laid: own });
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

describe('the times a sharded run places its files by, from a suite given to the share', () => {
  // Every shard reads the times on its own machine, so a read that failed on
  // one may have answered on another, and the two would place different files.
  it('stop the run when the remote cannot be reached, though the primary checkout holds a record', async () => {
    const { origin, first } = await mainline();
    const { worktree } = await laptop(origin, first);
    await git(worktree, 'remote', 'set-url', 'origin', join(home, 'nowhere.git'));

    await expect(suiteTimes({ root: worktree })).rejects.toThrow(/^record of "unit": the mainline's was not read; mainline main: /u);
  });

  it('are read from the primary checkout when the share holds no record, which every shard sees alike', async () => {
    const { origin, first } = await mainline({ publish: false });
    const { primary, worktree } = await laptop(origin, first);

    expect(await suiteTimes({ root: worktree })).toMatchObject({ recording: testCoverageFile(primary, { suite: 'unit' }) });
  });
});

describe('`variance share --suite unit` reads the mainline', () => {
  it('names the commit of the record the mainline holds, and lays it as the base the suite selects from', async () => {
    const ci = await mainline({ instrumentation: instrumentationId() });
    const { worktree } = await laptop(ci.origin, ci.first);

    const done = await suiteShare(worktree, { suite: 'unit', publish: false, format: 'github' }, { env: LOCAL });

    expect(done).toEqual({
      lines: [`commit=${ci.first}`, 'based=true'],
      notes: [expect.stringMatching(/^record of "unit": read from mainline main, published at /u)],
      exit: EXIT_CLEAN,
    });
    expect(keepsCases(testCoverageFile(worktree, { suite: 'unit' }))).toBe(true);
  });

  it("prints the commit alone for `$GITHUB_OUTPUT`, and says on stderr why a record under other probes leaves the suite no base", async () => {
    const ci = await mainline();
    const { worktree } = await laptop(ci.origin, ci.first);
    const out: string[] = [];
    const err: string[] = [];

    const exit = await runRootShare({ command: 'share', config: join(worktree, 'variance.config.json'), suite: 'unit', publish: false, reports: [], format: 'github' }, { out: (text) => out.push(text), err: (text) => err.push(text) }, worktree, { env: LOCAL });

    expect({ exit, out, err }).toEqual({
      exit: EXIT_CLEAN,
      out: [`commit=${ci.first}\n`],
      err: [expect.stringMatching(
        /^record of "unit": read from mainline main, published at .*\n::notice::record of "unit": the mainline's record at .* was written under the probes `fixture`, .*and it was not laid\. So unit has no base: it runs whole, and its coverage is printed without a comparison\.\n$/su,
      )],
    });
    expect(existsSync(testCoverageFile(worktree, { suite: 'unit' }))).toBe(false);
  });

  it('names no commit when the mainline holds no record, and says why beside it', async () => {
    const ci = await mainline({ publish: false });
    const { worktree } = await laptop(ci.origin, ci.first);

    expect(await suiteShare(worktree, { suite: 'unit', publish: false, format: 'github' }, { env: LOCAL })).toEqual({
      lines: ['commit='],
      notes: [
        'record of "unit": the share has none either; mainline main: nothing is published there.',
        "::notice::The mainline's unit record was not read. So unit has no base: it runs whole, and its coverage is printed without a comparison.",
      ],
      exit: EXIT_CLEAN,
    });
  });

  it('takes `--format` only to read the mainline', () => {
    expect(parseArgs(['share', '--suite', 'unit', '--format', 'github'])).toMatchObject({ command: 'share', suite: 'unit', format: 'github' });
    expect(parseArgs(['share', '--format', 'github'])).toMatchObject({ command: 'share', format: 'github' });
    expect(() => parseArgs(['share', '--suite', 'unit', '--format', 'json'])).toThrow('--format must be text or github, not `json`');
    expect(() => parseArgs(['share', '--suite', 'unit', '--publish', '--format', 'github'])).toThrow(
      '`--format` shapes what `share` reads for the root config\'s suites; a publish prints what it wrote',
    );
    expect(() => parseArgs(['share', '--suite', 'unit', '--publish', '--format', 'text'])).toThrow(
      '`--format` shapes what `share` reads for the root config\'s suites; a publish prints what it wrote',
    );
    expect(() => parseArgs(['share', '--mainline', 'main', '--format', 'github'])).toThrow(
      '`--format` shapes what `share` reads for the root config\'s suites; a publish prints what it wrote',
    );
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
    const locked = await withIndexLock(own, (lock) => seedTestCoverage(lock, worktree, 'fixture'));
    const seeded = locked.held ? locked.value : undefined;

    expect(seeded).toMatchObject({ from: 'mainline', record: { mainline: 'main', commit: ci.first } });
    expect(await readFile(own)).toEqual(ci.record);
    expect(await readFile(own)).not.toEqual(record);
    const published = (await readCommitRuns(base.file))!;
    expect(await readCommitRuns(own)).toEqual({ ...published, runs: 0 });
  });

  it('`variance select` reads the mainline\'s record, and says so, where the primary checkout holds one too', async () => {
    const { origin, first } = await mainline();
    const { worktree } = await laptop(origin, first);
    await writeFile(join(worktree, 'src/total.ts'), 'export const changed = true;\n');

    const { err } = await selectedIn(worktree);

    expect(err).toContain(`record of "unit": read from mainline main, published at ${first}`);
  });

  it('keeps the record it fetched at the merge base, a day later and with the remote gone', async () => {
    const { origin, first } = await mainline();
    const { worktree } = await laptop(origin, first);
    expect(await suiteBase(worktree, { env: LOCAL })).toMatchObject({ from: 'mainline' });
    await git(worktree, 'remote', 'set-url', 'origin', join(home, 'nowhere.git'));

    expect(await suiteBase(worktree, { env: LOCAL })).toMatchObject({ from: 'mainline', mainline: { commit: first, earlier: { reused: 'nearest' } } });
    const declared = declaredSuites(worktree)?.find((one) => one.name === 'unit');
    const later = await mainlineBase(worktree, declared, { env: LOCAL, now: Date.now() + 24 * 60 * 60_000 });
    expect(later).toMatchObject({ commit: first, earlier: { reused: 'nearest' } });
  });

  it('asks for the merge base with the mainline once, fetching or reusing', async () => {
    const { origin, first } = await mainline();
    const { worktree } = await laptop(origin, first);
    const trace = join(home, 'trace2.json');
    const mergeBases = async (): Promise<number> => {
      const asked = (await readFile(trace, 'utf8')).split('\n').filter((line) => line.includes('"event":"start"') && line.includes('"merge-base"')).length;
      await rm(trace);
      return asked;
    };
    process.env['GIT_TRACE2_EVENT'] = trace;
    try {
      expect(await suiteBase(worktree, { env: LOCAL })).toMatchObject({ from: 'mainline' });
      expect(await mergeBases()).toBe(1);
      expect(await suiteBase(worktree, { env: LOCAL })).toMatchObject({ mainline: { earlier: { reused: 'nearest' } } });
      expect(await mergeBases()).toBe(1);
    } finally {
      delete process.env['GIT_TRACE2_EVENT'];
    }
  });
});

it.todo(
  'a push to main publishes suite-v1/unit to refs/variance/mainline/main on GitHub, and the next pull request\'s `yarn test:since` reads it — needs check.yml running on the repository with `contents: write` on its publish job',
);
