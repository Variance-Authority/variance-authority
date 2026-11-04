import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readTestCoverage, testCoverageFile, writeTestCoverage, type TestCoverage } from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import { landJourneys } from './land.js';

/**
 * A landing over a record another build wrote. Which file it is decides: the
 * checkout's cached record is the tool's to replace, one named by `--into` is not.
 */

let home: string;

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), 'variance-land-replaces-')));
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'cache'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

/** A record under `instrumentation` holding `test` alone. */
function recorded(test: string, instrumentation: string): TestCoverage {
  return {
    version: 3,
    instrumentation,
    commit: 'c0ffee',
    tests: [{ file: test, complete: true, preconditions: [] }],
    modules: [],
  };
}

/** One shard of the newer build on disk. */
async function shard(): Promise<string> {
  const path = join(home, 'shard-1.bin');
  await writeTestCoverage(path, recorded('shard.test.ts', 'newer'));
  return path;
}

describe('landJourneys over a record under other probes', () => {
  it('replaces the one in the checkout\'s cache, under the shards\' probes, and says so in one line', async () => {
    const cached = testCoverageFile(home);
    await mkdir(dirname(cached), { recursive: true });
    await writeTestCoverage(cached, recorded('left.test.ts', 'older'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const landed = await landJourneys(home, [await shard()]);

    expect(landed.at).toBe(cached);
    const record = await readTestCoverage(cached);
    expect(record.instrumentation).toBe('newer');
    expect(record.tests.map((test) => test.file)).toEqual(['shard.test.ts']);
    const said = warn.mock.calls.map(([line]) => String(line));
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(new RegExp(`^variance-authority replaced the record at ${cached}: .*\`older\`.*\`newer\``, 'u'));
  });

  it('refuses the one `--into` names, and leaves it byte for byte', async () => {
    const into = join(home, 'handed-in.bin');
    await writeTestCoverage(into, recorded('left.test.ts', 'older'));
    const before = await readFile(into);

    const landing = landJourneys(home, [await shard()], into);

    await expect(landing).rejects.toBeInstanceOf(OperatorError);
    await expect(landing).rejects.toThrow(new RegExp(`^the shards cannot be laid over the snapshot already at ${into}: .*\`older\`.*\`newer\`.*delete it and land again`, 'su'));
    expect(Buffer.compare(await readFile(into), before)).toBe(0);
  });
});
