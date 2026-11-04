import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { evaluate, SOURCE } from './__fixtures__/browser-page.js';
import { commitRunsFile } from './commit-runs.js';
import { readTestCoverage, testCoverageFile, writeTestCoverage, type TestCoverage } from './index.js';
import { recordExecution, testSelectionProbes } from './journal.js';
import { ownLayerFile } from './own-layer.js';
import { prepareRecord } from './replaced-record.js';

/** The record of a checkout about to take a run under the probes `newer`. */

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

const present = (path: string): Promise<boolean> => readFile(path).then(() => true, () => false);

describe('prepareRecord', () => {
  it('removes a cached record under other probes with the files beside it, in one line', async () => {
    await writeTestCoverage(file, recorded('older'));
    await writeFile(commitRunsFile(file), 'runs of the older build');
    await writeFile(ownLayerFile(file), '{"ran":[]}');

    await prepareRecord(file, root, 'newer', { cacheRoot });

    expect([await present(file), await present(commitRunsFile(file)), await present(ownLayerFile(file))]).toEqual([false, false, false]);
    expect(warn.mock.calls).toEqual([[expect.stringMatching(/^variance-authority replaced the record at .*`older`.*`newer`, so this run cannot be laid over it\.$/u)]]);
  });

  it('replaces it once when two workers ask at once', async () => {
    await writeTestCoverage(file, recorded('older'));

    await Promise.all([prepareRecord(file, root, 'newer', { cacheRoot }), prepareRecord(file, root, 'newer', { cacheRoot })]);

    expect(await present(file)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('replaces it for a shard that records alone', async () => {
    await writeTestCoverage(file, recorded('older'));

    await prepareRecord(file, root, 'newer', { alone: true, cacheRoot });

    expect(await present(file)).toBe(false);
  });

  it('leaves a record under the same probes', async () => {
    await writeTestCoverage(file, recorded('newer'));

    await prepareRecord(file, root, 'newer', { cacheRoot });

    expect((await readTestCoverage(file)).instrumentation).toBe('newer');
    expect(warn).not.toHaveBeenCalled();
  });

  it('leaves it for a run that lays no coverage, which lays over any probes', async () => {
    await writeTestCoverage(file, recorded('older'));

    await prepareRecord(file, root, undefined, { cacheRoot });

    expect((await readTestCoverage(file)).instrumentation).toBe('older');
  });

  it('leaves a record this build cannot read, for the lay to refuse', async () => {
    await writeFile(file, 'half a copy of something else');

    await prepareRecord(file, root, 'newer', { cacheRoot });

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

  it('leaves a record at a path it was handed, whatever its probes', async () => {
    const handed = join(root, 'coverage.bin');
    await writeTestCoverage(handed, recorded('older'));

    await prepareRecord(handed, root, 'newer', { cacheRoot });

    expect((await readTestCoverage(handed)).instrumentation).toBe('older');
    expect(warn).not.toHaveBeenCalled();
  });
});
