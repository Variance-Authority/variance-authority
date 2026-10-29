import { readdir, readFile, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commitRunsFile, testCoverageFile, writeCommitRuns, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { landJourneys } from './land.js';
import { published, wholeRecord } from './mainline-fixture.js';

/**
 * A landing whose snapshot or runs record cannot be written — a full disk, a
 * read-only volume — changes nothing, the cases the snapshot carries included.
 * Both are staged before either replaces what is there, so the write that fails
 * is a staging. A combined record that cannot be read back is refused as the
 * reader said, and changes nothing either.
 */

/** Once set, every write of `file` into this directory fails as a full disk does. */
const full = vi.hoisted(() => ({
  directory: undefined as string | undefined,
  file: 'snapshot' as 'snapshot' | 'runs record',
  /** Once set, the staged combine is cut short, as a full disk leaves a file. */
  combined: false,
}));

vi.mock('@variance-authority/sense/test-selection', async (original) => {
  const actual = await original<typeof import('@variance-authority/sense/test-selection')>();
  const { truncateSync } = await import('node:fs');
  const failing = (file: typeof full.file, to: string) => {
    if (full.file === file && full.directory !== undefined && dirname(to) === full.directory) {
      throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
    }
  };
  return {
    ...actual,
    writeCoverageBytes: async (...args: Parameters<typeof actual.writeCoverageBytes>) => {
      failing('snapshot', args[0]);
      return actual.writeCoverageBytes(...args);
    },
    combineRecords: (...args: Parameters<typeof actual.combineRecords>) => {
      const combined = actual.combineRecords(...args);
      if (full.combined) truncateSync(args[1], 64);
      return combined;
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
  full.combined = false;
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
  await rm(home, { recursive: true, force: true });
});

describe('landJourneys when what it stages cannot be written', () => {
  it.each(['snapshot', 'runs record'] as const)(
    'leaves the snapshot with its cases and the runs record as they were when the %s cannot be written, and no staged file behind',
    async (file) => {
      const { dir, first } = await published(home, { publish: false, record: wholeRecord });
      const record = testCoverageFile(dir, { suite: 'unit' });
      const snapshot = await readFile(record);
      // The fixture leaves no runs record beside the snapshot. One is written here, so a landing that changed it would show.
      await writeCommitRuns(commitRunsFile(record), { latest: '', runs: 1, landings: [{ files: ['test/total.test.ts'] }] });
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
      expect(await readFile(commitRunsFile(record))).toEqual(runs);
      expect((await readdir(dirname(record))).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    },
  );

  it('refuses a combine it cannot read back with the reader\'s own words, and leaves the snapshot and no staged file', async () => {
    const { dir, first } = await published(home, { publish: false, record: wholeRecord });
    const record = testCoverageFile(dir, { suite: 'unit' });
    const snapshot = await readFile(record);
    const shard = join(home, 'shard-1.bin');
    await writeTestCoverage(shard, { version: 3, instrumentation: 'fixture', commit: first, tests: [{ file: 'test/total.test.ts', complete: true, preconditions: [] }], modules: [] });

    full.combined = true;
    await expect(landJourneys(dir, [shard], record)).rejects.toThrow(/^not a variance-authority test coverage artifact$/);

    expect(await readFile(record)).toEqual(snapshot);
    expect((await readdir(dirname(record))).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});
