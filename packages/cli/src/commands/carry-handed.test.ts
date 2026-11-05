import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cacheRootFor, declaredSuites, mainlineReadRoot, readFetchedMainline } from '@variance-authority/sense/test-selection';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OperatorError } from '../exit.js';
import type { Env } from '../share-lines.js';
import { handBase, handedOutputs, moveBase, receiveBase } from './carry-handed.js';
import { mainlineBase, readMissedMainline } from './mainline-base.js';
import { forgetLineAnswers, git, gitPublished, publishedAt } from './mainline-fixture.js';

/**
 * One job of a run reads the line, and every other job, a re-run of a failed
 * shard among them, stands on that read.
 *
 * The line moves while a run is under way, and a shard re-run a day later reads
 * a line that moved further. `carry hand` writes what one job read to a
 * directory the host moves as an artifact, and `carry receive` lays it in
 * another job's checkout, so every job selects from the same record. Each test
 * has two clones with caches of their own, as two CI jobs have.
 */

const LOCAL: Env = {};
let home: string;
let handed: string;

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), 'variance-carry-handed-')));
  handed = join(home, 'handed');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

/** A fresh clone of `origin` at `name`, reading from a cache of its own. */
async function job(origin: string, name: string): Promise<string> {
  const dir = join(home, name);
  await git(home, 'clone', '--quiet', origin, dir);
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, `${name}-cache`));
  return dir;
}

/** What a reader in `dir` answers for `unit`. */
async function read(dir: string) {
  return mainlineBase(dir, declaredSuites(dir)?.find((one) => one.name === 'unit'), { env: LOCAL });
}

/** A commit pushed to `ci`'s `main`, with the record CI made there published. */
async function moved(ci: string): Promise<string> {
  await git(ci, 'commit', '--quiet', '--allow-empty', '-m', 'next');
  await git(ci, 'push', '--quiet', 'origin', 'main');
  const commit = await git(ci, 'rev-parse', 'HEAD');
  await publishedAt(home, ci, commit);
  return commit;
}

const refusal = async (doing: Promise<unknown>): Promise<string> => {
  const error = await doing.then(() => undefined, (thrown: unknown) => thrown);
  expect(error).toBeInstanceOf(OperatorError);
  return (error as OperatorError).message;
};

describe('a run stands on the record one job read', () => {
  it('reads the record handed on in another job, with a newer one on the line', async () => {
    const { ci, origin, first } = await gitPublished(home);
    const plan = await job(origin, 'plan');
    await handBase(plan, handed, { env: LOCAL });
    await moved(ci);

    const shard = await job(origin, 'shard');
    await receiveBase(shard, handed);

    expect(await read(shard)).toMatchObject({ commit: first, earlier: { reused: 'handed' } });
  });

  it('stands on the same record in the job that handed it', async () => {
    const { ci, origin, first } = await gitPublished(home);
    const plan = await job(origin, 'plan');
    await handBase(plan, handed, { env: LOCAL });
    await moved(ci);
    await git(plan, 'pull', '--quiet');

    expect(await read(plan)).toMatchObject({ commit: first, earlier: { reused: 'handed' } });
  });

  it('hands only the record it read, and names the suites it read', async () => {
    const { origin, first } = await gitPublished(home);
    const plan = await job(origin, 'plan');
    await mkdir(join(mainlineReadRoot(cacheRootFor(plan), 'unit'), 'an-older-commit'), { recursive: true });

    const done = await handBase(plan, handed, { env: LOCAL });

    expect(done).toMatchObject({ suites: ['unit'], commits: [first] });
    expect(JSON.parse(await readFile(join(handed, 'handed.json'), 'utf8'))).toEqual({ suites: ['unit'] });
    expect(readFetchedMainline(join(handed, 'unit'))).toMatchObject({ commit: first });
    await expect(readFile(join(handed, 'unit', first, 'coverage.bin'))).resolves.toBeDefined();
    expect(existsSync(join(handed, 'unit', 'an-older-commit'))).toBe(false);
  });

  it('asks the line, however a checkout that kept its cache was handed before', async () => {
    const { ci, origin } = await gitPublished(home);
    const plan = await job(origin, 'plan');
    await handBase(plan, handed, { env: LOCAL });
    const second = await moved(ci);
    await git(plan, 'pull', '--quiet');
    await forgetLineAnswers(join(home, 'plan-cache'));

    expect(await handBase(plan, handed, { env: LOCAL })).toMatchObject({ commits: [second] });
  });

  it('stands on the line\'s answer that it has no record, however long ago and whatever the line published since', async () => {
    const { ci, origin, first } = await gitPublished(home, { publish: false });
    const plan = await job(origin, 'plan');
    await handBase(plan, handed, { env: LOCAL });
    const missed = readMissedMainline(join(handed, 'unit'))!;
    await publishedAt(home, ci, first);

    const shard = await job(origin, 'shard');
    await receiveBase(shard, handed);
    const note = join(mainlineReadRoot(cacheRootFor(shard), 'unit'), 'missed.json');
    await writeFile(note, JSON.stringify({ ...JSON.parse(await readFile(note, 'utf8')), at: new Date(0).toISOString() }));

    expect(await read(shard)).toMatchObject({ miss: { kind: missed.miss.kind } });
    const asked = await mainlineBase(shard, declaredSuites(shard)?.find((one) => one.name === 'unit'), { env: LOCAL, fetch: 'always' });
    expect(asked).toMatchObject({ commit: first });
  });

  it('hands nothing for a suite the share does not carry, and the manifest still arrives', async () => {
    const { origin } = await gitPublished(home);
    const plan = await job(origin, 'plan');
    await writeFile(join(plan, 'variance.config.json'), JSON.stringify({ suites: { unit: { kind: 'unit' } } }));

    expect(await handBase(plan, handed, { env: LOCAL })).toMatchObject({ suites: [], commits: [] });

    expect(await receiveBase(plan, handed)).toMatchObject({ suites: [] });
  });
});

describe('a job refuses to read the line on its own', () => {
  it('when nothing was handed', async () => {
    const { origin } = await gitPublished(home);
    const shard = await job(origin, 'shard');

    expect(await refusal(receiveBase(shard, join(home, 'absent')))).toContain('carry hand');
  });

  it('when the manifest names a suite the directory holds nothing for', async () => {
    const { origin } = await gitPublished(home);
    const shard = await job(origin, 'shard');
    await mkdir(handed);
    await writeFile(join(handed, 'handed.json'), JSON.stringify({ suites: ['unit'] }));

    expect(await refusal(receiveBase(shard, handed))).toContain('unit');
  });

  it('when the handed record does not read, because a reader would pass over it and ask the line', async () => {
    const { origin, first } = await gitPublished(home);
    const plan = await job(origin, 'plan');
    await handBase(plan, handed, { env: LOCAL });
    await writeFile(join(handed, 'unit', first, 'coverage.bin'), 'not a record');

    const shard = await job(origin, 'shard');

    expect(await refusal(receiveBase(shard, handed))).toContain('unit');
  });

  it('when the handed record is not there', async () => {
    const { origin, first } = await gitPublished(home);
    const plan = await job(origin, 'plan');
    await handBase(plan, handed, { env: LOCAL });
    await rm(join(handed, 'unit', first), { recursive: true });

    const shard = await job(origin, 'shard');

    expect(await refusal(receiveBase(shard, handed))).toContain('unit');
  });
});

describe('what a workflow reads of it', () => {
  it('names the commit the records were made at, which a pull request merges its head with', () => {
    expect(handedOutputs({ suites: ['unit', 'web'], commits: ['abc'], lines: [] })).toEqual(['commit=abc', 'handed=unit web']);
  });

  it('names none when the suites\' records were made at different commits, or none was read', () => {
    expect(handedOutputs({ suites: ['unit', 'web'], commits: ['abc', 'def'], lines: [] })[0]).toBe('commit=');
    expect(handedOutputs({ suites: [], commits: [], lines: [] })).toEqual(['commit=', 'handed=']);
  });

  it('prints outputs to the output stream and what it read to the error stream under github', async () => {
    const { origin, first } = await gitPublished(home);
    const plan = await job(origin, 'plan');
    const out: string[] = [];
    const err: string[] = [];

    await moveBase({ command: 'carry', direction: 'hand', dir: handed, format: 'github' }, plan, { out: (text) => out.push(text), err: (text) => err.push(text) });

    expect(out.join('')).toBe(`commit=${first}\nhanded=unit\n`);
    expect(err.join('')).toContain(first.slice(0, 12));
  });
});
