import { readdir, readFile, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testCoverageFile, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { landJourneys } from './land.js';
import { published, wholeRecord } from './mainline-fixture.js';

/**
 * A landing whose snapshot cannot be written — a full disk, a read-only
 * volume — changes nothing, the case index included. The snapshot is staged
 * before the index is touched, so the write that fails is the staging.
 */

/** Once set, every snapshot written into this directory fails as a full disk does. */
const full = vi.hoisted(() => ({ directory: undefined as string | undefined }));

vi.mock('@variance-authority/sense/test-selection', async (original) => {
  const actual = await original<typeof import('@variance-authority/sense/test-selection')>();
  return {
    ...actual,
    writeTestCoverage: async (...args: Parameters<typeof actual.writeTestCoverage>) => {
      if (full.directory !== undefined && dirname(args[0]) === full.directory) {
        throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
      }
      return actual.writeTestCoverage(...args);
    },
  };
});

let home: string;

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), 'variance-land-staging-')));
  process.env['VARIANCE_AUTHORITY_CACHE'] = join(home, 'cache');
});

afterEach(async () => {
  full.directory = undefined;
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
  await rm(home, { recursive: true, force: true });
});

describe('landJourneys when the snapshot cannot be written', () => {
  it('leaves the snapshot and the case index as they were, and no staged file behind', async () => {
    const { dir, first } = await published(home, { publish: false, record: wholeRecord });
    const record = testCoverageFile(dir, { suite: 'unit' });
    const snapshot = await readFile(record);
    const cases = await readFile(`${record}.cases.bin`);
    // A shard that finished the file the index has cases for, and left none:
    // landed, it would remove the index.
    const shard = join(home, 'shard-1.bin');
    await writeTestCoverage(shard, {
      version: 3,
      instrumentation: 'fixture',
      commit: first,
      tests: [{ file: 'test/total.test.ts', complete: true, preconditions: [] }],
      modules: [],
    });

    full.directory = dirname(record);
    await expect(landJourneys(dir, [shard], record)).rejects.toThrow('ENOSPC');

    expect(await readFile(record)).toEqual(snapshot);
    expect(await readFile(`${record}.cases.bin`)).toEqual(cases);
    expect((await readdir(dirname(record))).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});
