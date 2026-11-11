import { existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { updateSourceIndex } from '@variance-authority/sense';
import { landRun, nearestRecord, seedTestCoverage, testCoverageFile, withIndexLock } from '@variance-authority/sense/test-selection';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OperatorError } from '../exit.js';
import type { Env } from '../share-lines.js';
import { handBase, receiveBase } from './carry-handed.js';
import { keepPushed, takePushed } from './carry-pushed.js';
import { selectSuite } from './select-command.js';
import { suiteTimes } from './suite-times.js';
import { DISCOUNTS, git, gitPublished, ranWhole, recordIn } from './mainline-fixture.js';
import { publishedNext, ranAlone } from './milestone-pin.fixture.js';
import { suiteBase } from './suite-base.js';

/**
 * A shard reads the record the run's orchestrator gave it and writes only what
 * it ran.
 *
 * The orchestrator receives the mainline's read and takes what the last push
 * ran over it: that record is what the plan priced. A shard receives the same
 * read and takes the same push with `--as-base`, which lays it where the read
 * sits rather than as the checkout's own record, so the shard selects from it
 * and its run lands on nothing.
 */

const LOCAL: Env = {};
let home: string;
let handed: string;
let carried: string;

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), 'variance-carry-as-base-')));
  handed = join(home, 'handed');
  carried = join(home, 'carried');
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

/** The orchestrator: it reads the line, hands the read on, and keeps what an earlier push of the pull request ran. */
async function orchestrated(): Promise<{ origin: string; pushed: Buffer }> {
  const { origin, first } = await gitPublished(home);
  const plan = await job(origin, 'plan');
  await handBase(plan, handed, { env: LOCAL });
  await recordIn(plan, first, ['test/other.test.ts'], [DISCOUNTS]);
  await ranWhole(testCoverageFile(plan, { suite: 'unit' }), first);
  await keepPushed(plan, carried, undefined);
  return { origin, pushed: await readFile(join(carried, 'unit', 'coverage.bin')) };
}

describe('a shard takes the last push as its base', () => {
  it('selects from the record the orchestrator took, and keeps none of its own', async () => {
    const { origin, pushed } = await orchestrated();
    const shard = await job(origin, 'shard');
    await receiveBase(shard, handed);

    expect(await takePushed(shard, carried, { asBase: true })).toEqual({ taken: ['unit'], left: [] });

    const nearest = nearestRecord(shard, { suite: 'unit' });
    expect(nearest.origin).toBe('mainline');
    expect(await readFile(nearest.file)).toEqual(pushed);
    expect(existsSync(testCoverageFile(shard, { suite: 'unit' }))).toBe(false);
  });

  it('selects and places its later wave from that record, not from what its earlier wave ran', async () => {
    const { origin } = await orchestrated();
    const shard = await job(origin, 'shard');
    await receiveBase(shard, handed);
    await takePushed(shard, carried, { asBase: true });
    // What the shard's `variance index` step publishes before its waves; under CI, selection refuses to build it itself.
    await updateSourceIndex(shard);
    const handedRecord = nearestRecord(shard, { suite: 'unit' }).file;
    // The near wave landed: the shard's own layer now holds only what it ran.
    await recordIn(shard, await git(shard, 'rev-parse', 'HEAD'), ['test/total.test.ts'], [DISCOUNTS]);

    const asked = { root: shard, suite: 'unit', beneath: true } as const;
    expect((await selectSuite(asked)).read).toEqual((await selectSuite({ root: shard, suite: 'unit', record: handedRecord })).read);
    expect((await suiteTimes(asked)).recording).toBe(handedRecord);
  });

  it('selects from the bytes the plan priced when the line moved on since the last push', async () => {
    const { ci, origin, first } = await gitPublished(home);
    // The last push ran over the mainline's first record, and kept what it ran.
    const earlier = await job(origin, 'earlier');
    expect(await suiteBase(earlier, { env: LOCAL })).toMatchObject({ from: 'mainline', mainline: { commit: first } });
    const own = testCoverageFile(earlier, { suite: 'unit' });
    await withIndexLock(own, (lock) => seedTestCoverage(lock, earlier, 'fixture'));
    await landRun(own, ranAlone(first, 'test/total.test.ts'), earlier);
    await keepPushed(earlier, carried, undefined);
    // Main publishes a newer record before this push runs, and the plan reads it.
    await publishedNext(home, ci);
    const plan = await job(origin, 'plan');
    await handBase(plan, handed, { env: LOCAL });
    expect((await takePushed(plan, carried)).taken).toEqual(['unit']);
    const priced = (await suiteTimes({ root: plan, suite: 'unit' })).recording;
    const shard = await job(origin, 'shard');
    await receiveBase(shard, handed);
    await takePushed(shard, carried, { asBase: true });

    expect(await readFile(nearestRecord(shard, { suite: 'unit' }).file)).toEqual(await readFile(priced));
  });

  it('reads the handed record when the last push kept nothing', async () => {
    const { origin } = await gitPublished(home);
    const plan = await job(origin, 'plan');
    await handBase(plan, handed, { env: LOCAL });
    const shard = await job(origin, 'shard');
    await receiveBase(shard, handed);
    const before = nearestRecord(shard, { suite: 'unit' });

    expect(await takePushed(shard, carried, { asBase: true })).toEqual({ taken: [], left: [] });
    expect(nearestRecord(shard, { suite: 'unit' })).toEqual(before);
  });

  it('refuses when no read was received, rather than select from the line on its own', async () => {
    const { origin } = await orchestrated();
    const shard = await job(origin, 'shard');

    const error = await takePushed(shard, carried, { asBase: true }).then(() => undefined, (thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(OperatorError);
    expect((error as OperatorError).message).toContain('carry receive');
    expect(existsSync(testCoverageFile(shard, { suite: 'unit' }))).toBe(false);
  });
});
