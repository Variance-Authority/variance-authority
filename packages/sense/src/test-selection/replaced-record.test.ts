import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { instrumentationId } from '../instrument/index.js';
import { evaluate, SOURCE } from './__fixtures__/browser-page.js';
import { commitRunsFile } from './commit-runs.js';
import { LOCK_POLL_MS, withIndexLock } from './index-lock.js';
import { readTestCoverage, testCoverageFile, writeTestCoverage, type TestCoverage } from './index.js';
import { recordExecution, testSelectionProbes } from './journal.js';
import { ownLayerFile } from './own-layer.js';
import { prepareRecord } from './replaced-record.js';

/** The record of a checkout about to take a run under the probes `newer`. */

/** The next read of `path` waits for `held`, so a writer can be stopped where it copies its base. */
const slowRead = vi.hoisted(() => ({
  path: undefined as string | undefined,
  entered: (): void => undefined,
  held: Promise.resolve(),
}));

vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  const readFile = async (...args: Parameters<typeof actual.readFile>): Promise<unknown> => {
    if (args[0] === slowRead.path) {
      slowRead.path = undefined;
      slowRead.entered();
      await slowRead.held;
    }
    return actual.readFile(...args);
  };
  return { ...actual, readFile };
});

let root: string;
let cacheRoot: string;
let file: string;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'variance-replaced-')));
  cacheRoot = join(root, 'cache');
  file = testCoverageFile(root, { cacheRoot });
  await mkdir(dirname(file), { recursive: true });
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

/** A record under `instrumentation`. */
function recorded(instrumentation: string): TestCoverage {
  return { version: 3, instrumentation, tests: [{ file: 'left.test.ts', complete: true, preconditions: [] }], modules: [] };
}

/** {@link prepareRecord} over the record at `at`, in a hold of its own. */
const prepare = (at: string, instrumentation: string | undefined, options: { readonly alone?: boolean } = {}) =>
  withIndexLock(at, (lock) => prepareRecord(lock, root, instrumentation, { cacheRoot, ...options }));

const present = (path: string): Promise<boolean> => readFile(path).then(() => true, () => false);

describe('prepareRecord', () => {
  it('removes a cached record under other probes with the files beside it, in one line', async () => {
    await writeTestCoverage(file, recorded('older'));
    await writeFile(commitRunsFile(file), 'runs of the older build');
    await writeFile(ownLayerFile(file), '{"ran":[]}');

    await prepare(file, 'newer');

    expect([await present(file), await present(commitRunsFile(file)), await present(ownLayerFile(file))]).toEqual([false, false, false]);
    expect(warn.mock.calls).toEqual([[expect.stringMatching(/^variance-authority replaced the record at .*`older`.*`newer`, so this run cannot be laid over it\.$/u)]]);
  });

  it('replaces it once when two workers ask at once', async () => {
    await writeTestCoverage(file, recorded('older'));

    await Promise.all([prepare(file, 'newer'), prepare(file, 'newer')]);

    expect(await present(file)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('replaces it for a shard that records alone', async () => {
    await writeTestCoverage(file, recorded('older'));

    await prepare(file, 'newer', { alone: true });

    expect(await present(file)).toBe(false);
  });

  it('leaves a record under the same probes', async () => {
    await writeTestCoverage(file, recorded('newer'));

    await prepare(file, 'newer');

    expect((await readTestCoverage(file)).instrumentation).toBe('newer');
    expect(warn).not.toHaveBeenCalled();
  });

  it('leaves it for a run that lays no coverage, which lays over any probes', async () => {
    await writeTestCoverage(file, recorded('older'));

    await prepare(file, undefined);

    expect((await readTestCoverage(file)).instrumentation).toBe('older');
  });

  it('leaves a record this build cannot read, for the lay to refuse', async () => {
    await writeFile(file, 'half a copy of something else');

    await prepare(file, 'newer');

    expect(await readFile(file, 'utf8')).toBe('half a copy of something else');
  });

  it('runs for a recording of a page, which then lands over nothing', async () => {
    const module = join(root, 'price.js');
    await writeFile(module, SOURCE, 'utf8');
    const realm = evaluate(testSelectionProbes({ root }).transform.handler(SOURCE, module)!.code);
    realm.price(20);
    await writeTestCoverage(file, recorded('older'));

    await recordExecution({
      root,
      cacheRoot,
      coverageFile: file,
      subjects: [{ owner: 'story:price--premium', journal: realm.collector.drain() }],
    });

    expect((await readTestCoverage(file)).tests.map((test) => test.file)).toEqual(['story:price--premium']);
    expect(warn.mock.calls.filter(([line]) => String(line).includes(`replaced the record at ${file}`))).toHaveLength(1);
  });

  it('keeps a run another writer landed while this one was copying the base', async () => {
    const primary = join(root, 'primary');
    const feature = join(root, 'feature');
    const gitdir = join(primary, '.git', 'worktrees', 'feature');
    await mkdir(gitdir, { recursive: true });
    await mkdir(feature, { recursive: true });
    await writeFile(join(feature, '.git'), `gitdir: ${gitdir}\n`);
    const module = join(feature, 'price.js');
    await writeFile(module, SOURCE, 'utf8');
    const realm = evaluate(testSelectionProbes({ root: feature }).transform.handler(SOURCE, module)!.code);
    realm.price(20);
    const first = realm.collector.drain();
    realm.price(20);
    const second = realm.collector.drain();

    const base = testCoverageFile(primary, { cacheRoot });
    await mkdir(dirname(base), { recursive: true });
    await writeTestCoverage(base, recorded(first.instrumentation));
    const own = testCoverageFile(feature, { cacheRoot });
    await mkdir(dirname(own), { recursive: true });
    await writeTestCoverage(own, recorded('older'));

    const land = (owner: string, journal: typeof first) =>
      recordExecution({ root: feature, cacheRoot, coverageFile: own, subjects: [{ owner, journal }] });
    let release!: () => void;
    const copying = new Promise<void>((entered) => {
      slowRead.path = base;
      slowRead.entered = entered;
      slowRead.held = new Promise<void>((done) => (release = done));
    });
    const polled = vi.spyOn(globalThis, 'setTimeout');

    const slow = land('story:slow', first);
    await copying;
    let settled = false;
    const quick = land('story:quick', second).finally(() => (settled = true));
    // The other writer has landed, or is waiting for the lock this one holds.
    while (!settled && !polled.mock.calls.some(([, ms]) => ms === LOCK_POLL_MS)) {
      await new Promise((turn) => setImmediate(turn));
    }
    release();
    await Promise.all([slow, quick]);

    expect((await readTestCoverage(own)).tests.map((test) => test.file).sort()).toEqual(['left.test.ts', 'story:quick', 'story:slow']);
  });

  it('leaves it for a recording of a page that placed no module, which lays no coverage', async () => {
    await writeTestCoverage(file, recorded('older'));

    await recordExecution({
      root,
      cacheRoot,
      coverageFile: file,
      subjects: [{ owner: 'story:price--premium', journal: { instrumentation: instrumentationId(), modules: [] } }],
    });

    expect((await readTestCoverage(file)).instrumentation).toBe('older');
    expect(warn.mock.calls.filter(([line]) => String(line).includes('replaced the record'))).toEqual([]);
  });

  it('leaves a record at a path it was handed, whatever its probes', async () => {
    const handed = join(root, 'coverage.bin');
    await writeTestCoverage(handed, recorded('older'));

    await prepare(handed, 'newer');

    expect((await readTestCoverage(handed)).instrumentation).toBe('older');
    expect(warn).not.toHaveBeenCalled();
  });
});
