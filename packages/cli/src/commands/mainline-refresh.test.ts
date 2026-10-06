import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cacheRootFor, declaredSuites, mainlineReadRoot, testCoverageFile, writeFetchedMainline } from '@variance-authority/sense/test-selection';
import type { Env } from '../share-lines.js';
import type { Detach } from './detached.js';
import { main } from '../bin.js';
import { MAINLINE_REUSE_MS, mainlineBase, mainlineRead } from './mainline-base.js';
import { mainlineRefreshLock } from './mainline-refresh.js';
import { indexOutput } from './index-command.js';
import { BEFORE, DISCOUNTS, PUSH, ROUNDS, collectedBoth, git, gitPublished, ranHere, ranWhole, recordIn } from './mainline-fixture.js';
import { selectOutput } from './select-command.js';
import { publishSuite } from './suite-share.js';

/**
 * A workstation reader past the reuse window answers from the record fetched
 * last at once, and leaves the fetch of the mainline's record to a process of
 * its own, which the next command reads. CI and a library caller have no
 * process to hand it to, and fetch before they answer.
 */

const LOCAL: Env = {};
const NOW = Date.parse('2026-09-30T12:00:00.000Z');
const LATER = NOW + MAINLINE_REUSE_MS;
const at = (time: number) => new Date(time).toISOString();
const cwd = process.cwd();
let home: string;

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), 'variance-mainline-refresh-')));
});

afterEach(async () => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
  await rm(home, { recursive: true, force: true });
});

/**
 * A laptop clone that fetched `first` at `NOW`, after which the mainline
 * published `second`. The two records disagree on who runs `applyDiscount`:
 * `total.test.ts` at `first`, `other.test.ts` at `second`, so a change to it
 * selects by which record was read.
 */
async function behind() {
  const { ci, origin, first } = await gitPublished(home);
  const dir = join(home, 'clone');
  await git(home, 'clone', '--quiet', origin, dir);
  const laptopCache = join(home, 'laptop-cache');
  process.env['VARIANCE_AUTHORITY_CACHE'] = laptopCache;
  const declared = declaredSuites(dir)?.find((one) => one.name === 'unit');
  const readRoot = mainlineReadRoot(cacheRootFor(dir), 'unit');
  const base = (now: number, detach?: Detach) => mainlineBase(dir, declared, { env: LOCAL, now, ...(detach === undefined ? {} : { detach }) });
  expect(await base(NOW)).toMatchObject({ commit: first, fetched: at(NOW) });

  await git(ci, 'commit', '--quiet', '--allow-empty', '-m', 'second');
  const second = await git(ci, 'rev-parse', 'HEAD');
  await git(ci, 'push', '--quiet', 'origin', 'main');
  process.env['VARIANCE_AUTHORITY_CACHE'] = join(home, 'ci-cache');
  await recordIn(ci, second, ['test/other.test.ts'], [DISCOUNTS, ROUNDS]);
  await ranWhole(testCoverageFile(ci, { suite: 'unit' }), second);
  const done = await publishSuite(ci, 'unit', { env: PUSH }, { collected: await collectedBoth(home) });
  if (!('published' in done)) throw new Error(`the record was to reach mainline main: ${JSON.stringify(done)}`);
  process.env['VARIANCE_AUTHORITY_CACHE'] = laptopCache;
  await forgetLineAnswers(laptopCache);
  return { dir, declared, readRoot, base, first, second, lock: mainlineRefreshLock(readRoot) };
}

/** Take back the git cell's held answers under `cache`, as a minute passing would. */
async function forgetLineAnswers(cache: string): Promise<void> {
  const held = (await readdir(cache, { recursive: true })).filter((path) => basename(path) === 'variance-fetched');
  for (const dir of held) await rm(join(cache, dir), { recursive: true, force: true });
}

/** A detach that starts nothing, records what it was asked to start, and names `pid` as the process. */
function detaching(pid: number | undefined) {
  const started: (readonly string[])[] = [];
  const detach: Detach = (argv, log) => {
    started.push([...argv, log]);
    return pid;
  };
  return { started, detach };
}

describe('a workstation reader past the reuse window', () => {
  it('answers from the record fetched last, starts one process to fetch the mainline\'s, and the next read after it finished reads what it fetched', async () => {
    const { dir, declared, base, first, second, lock } = await behind();
    const { started, detach } = detaching(process.pid);

    const read = await base(LATER, detach);

    expect(read).toMatchObject({ commit: first, fetched: at(NOW), earlier: { refreshing: { pid: process.pid, log: lock.log } } });
    expect(started).toEqual([['share', '--suite', 'unit', lock.log]]);
    // While that process runs, a second reader starts no second one.
    expect(await base(LATER + 1, detach)).toMatchObject({ commit: first, earlier: { refreshing: { pid: process.pid } } });
    expect(started).toHaveLength(1);

    // The process: `share --suite unit` asks the mainline now, and gives the lock back.
    expect(await mainlineBase(dir, declared, { env: LOCAL, now: LATER + 2, refetch: true })).toMatchObject({ commit: second });
    expect(existsSync(lock.path)).toBe(false);

    expect(await base(LATER + 3, detach)).toMatchObject({ commit: second, fetched: at(LATER + 2), earlier: { reused: true } });
    expect(started).toHaveLength(1);
  });

  it('starts a process of its own when the one named in the lock is gone', async () => {
    const { readRoot, base, first, lock } = await behind();
    const gone = spawnSync('git', ['--version']).pid;
    await writeFile(lock.path, `${JSON.stringify({ pid: gone, log: join(readRoot, 'elsewhere.log') })}\n`);
    const { started, detach } = detaching(process.pid);

    expect(await base(LATER, detach)).toMatchObject({ commit: first, earlier: { refreshing: { pid: process.pid, log: lock.log } } });
    expect(started).toHaveLength(1);
  });

  it('fetches before it answers when no process could be started, and leaves no lock behind', async () => {
    const { base, second, lock } = await behind();
    const { started, detach } = detaching(undefined);

    const read = await base(LATER, detach);

    expect(read).toMatchObject({ commit: second, fetched: at(LATER) });
    expect(read).not.toHaveProperty('earlier');
    expect(started).toHaveLength(1);
    expect(existsSync(lock.path)).toBe(false);
  });

  it('fetches before it answers when starting the process throws, and leaves no lock behind', async () => {
    const { base, second, lock } = await behind();
    const detach: Detach = () => {
      throw new Error('the log could not be opened');
    };

    const read = await base(LATER, detach);

    expect(read).toMatchObject({ commit: second, fetched: at(LATER) });
    expect(read).not.toHaveProperty('earlier');
    expect(existsSync(lock.path)).toBe(false);
  });

  it('fetches before it answers when the lock does not read, and leaves that lock where it is', async () => {
    const { base, second, lock } = await behind();
    await writeFile(lock.path, 'not a lock\n');
    const { started, detach } = detaching(process.pid);

    const read = await base(LATER, detach);

    expect(read).toMatchObject({ commit: second, fetched: at(LATER) });
    expect(read).not.toHaveProperty('earlier');
    expect(started).toHaveLength(0);
    expect(await readFile(lock.path, 'utf8')).toBe('not a lock\n');
  });

  it('says which process is fetching, and where its output goes', async () => {
    const { base, first, lock } = await behind();
    const read = await base(LATER, detaching(4242).detach);
    if (read === undefined || 'miss' in read) throw new Error(`expected the record fetched last, read ${JSON.stringify(read)}`);

    expect(mainlineRead(read)).toBe(
      `record of "unit": read from mainline main, published at ${first}, fetched at ${at(NOW)}, more than 10 minutes ago, ` +
        `at the merge base with this checkout; kept at ${read.coverage}; ` +
        `process 4242 is fetching the mainline's record now, and a command run after it ends reads that record; ` +
        `its output is written to ${lock.log}`,
    );
  });
});

describe('a reader with no process to hand the fetch to', () => {
  it('fetches before it answers, as CI and a library caller do', async () => {
    const { base, second, lock } = await behind();

    expect(await base(LATER)).toMatchObject({ commit: second, fetched: at(LATER) });
    expect(existsSync(lock.path)).toBe(false);
  });
});

describe('`variance select` past the reuse window', () => {
  it('selects from the record fetched last and says a process is fetching the mainline\'s', async () => {
    const { dir, first, lock } = await behind();
    process.chdir(dir);
    await indexOutput({ cwd: dir });
    await writeFetchedMainline(cacheRootFor(dir), 'unit', { mainline: 'main', commit: first, fetched: at(Date.now() - MAINLINE_REUSE_MS - 1) });
    await forgetLineAnswers(join(home, 'laptop-cache'));
    const { started, detach } = detaching(process.pid);

    await writeFile(join(dir, 'src/total.ts'), BEFORE.replace('0.9', '0.8'));

    const selected = await selectOutput({ cwd: dir, format: 'plain', detach });

    // `select` prints what to skip. The record fetched last runs the change in `total.test.ts`, so it skips
    // `other.test.ts`; the mainline's would run it in `other.test.ts`, and skip `total.test.ts`.
    expect(selected.out).toBe('test/other.test.ts\n');
    expect(started).toEqual([['share', '--suite', 'unit', lock.log]]);
    expect(selected.err).toContain(`published at ${first}, fetched at `);
    expect(selected.err).toContain(`process ${String(process.pid)} is fetching the mainline's record now`);
  });

  it('says so too when this checkout\'s own record is the one it reads', async () => {
    const { dir, first, lock } = await behind();
    await ranHere(dir, first);
    await writeFetchedMainline(cacheRootFor(dir), 'unit', { mainline: 'main', commit: first, fetched: at(Date.now() - MAINLINE_REUSE_MS - 1) });
    await forgetLineAnswers(join(home, 'laptop-cache'));
    const { started, detach } = detaching(process.pid);

    const selected = await selectOutput({ cwd: dir, format: 'plain', detach });

    expect(started).toEqual([['share', '--suite', 'unit', lock.log]]);
    expect(selected.err).toContain('record of "unit": read from this checkout\'s own');
    expect(selected.err).toContain(`process ${String(process.pid)} is fetching the mainline's record now`);
  });

  it('is handed the program\'s process from the command line', async () => {
    const { dir, first, lock } = await behind();
    process.chdir(dir);
    await indexOutput({ cwd: dir });
    await writeFetchedMainline(cacheRootFor(dir), 'unit', { mainline: 'main', commit: first, fetched: at(Date.now() - MAINLINE_REUSE_MS - 1) });
    await forgetLineAnswers(join(home, 'laptop-cache'));
    const { started, detach } = detaching(process.pid);
    let err = '';

    const code = await main(['select', '--format', 'plain'], { out: () => {}, err: (text) => { err += text; }, detach });

    expect(code).toBe(0);
    expect(started).toEqual([['share', '--suite', 'unit', lock.log]]);
    expect(err).toContain(`process ${String(process.pid)} is fetching the mainline's record now`);
  });
});
