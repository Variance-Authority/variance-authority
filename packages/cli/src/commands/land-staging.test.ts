import { readdir, readFile, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commitRunsFile, testCoverageFile, writeCommitRuns, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { landJourneys } from './land.js';
import { published, wholeRecord } from './mainline-fixture.js';

/**
 * A landing whose snapshot or runs record cannot be written — a full disk, a
 * read-only volume — changes nothing, the case index included. Both are staged
 * before the index is touched, so the write that fails is a staging.
 */

/** Once set, every write of `file` into this directory fails as a full disk does. */
const full = vi.hoisted(() => ({
  directory: undefined as string | undefined,
  file: 'snapshot' as 'snapshot' | 'runs record',
}));

vi.mock('@variance-authority/sense/test-selection', async (original) => {
  const actual = await original<typeof import('@variance-authority/sense/test-selection')>();
  const failing = (file: typeof full.file, to: string) => {
    if (full.file === file && full.directory !== undefined && dirname(to) === full.directory) {
      throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
    }
  };
  return {
    ...actual,
    writeTestCoverage: async (...args: Parameters<typeof actual.writeTestCoverage>) => {
      failing('snapshot', args[0]);
      return actual.writeTestCoverage(...args);
    },
    writeCommitRuns: async (...args: Parameters<typeof actual.writeCommitRuns>) => {
      failing('runs record', args[0]);
      return actual.writeCommitRuns(...args);
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

describe('landJourneys when what it stages cannot be written', () => {
  it.each(['snapshot', 'runs record'] as const)(
    'leaves the snapshot, the runs record and the case index as they were when the %s cannot be written, and no staged file behind',
    async (file) => {
      const { dir, first } = await published(home, { publish: false, record: wholeRecord });
      const record = testCoverageFile(dir, { suite: 'unit' });
      const snapshot = await readFile(record);
      const cases = await readFile(`${record}.cases.bin`);
      // The fixture leaves no runs record beside the snapshot. One is written here, so a landing that changed it would show.
      await writeCommitRuns(commitRunsFile(record), { first: '', latest: '', runs: 1, files: ['test/total.test.ts'] });
      const runs = await readFile(commitRunsFile(record));
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
      full.file = file;
      await expect(landJourneys(dir, [shard], record)).rejects.toThrow('ENOSPC');

      expect(await readFile(record)).toEqual(snapshot);
      expect(await readFile(`${record}.cases.bin`)).toEqual(cases);
      expect(await readFile(commitRunsFile(record))).toEqual(runs);
      expect((await readdir(dirname(record))).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    },
  );
});
