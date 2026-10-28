import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { caseSectionsAt, sharedRecord } from './case-record.js';
import { landRun } from './commit-runs.js';
import { notingRead, recordDigestAt } from './record-base.js';
import { CrossingSets } from './crossing-sets.js';
import { encodeSetExecutionIndex } from './execution-set-format.js';
import { writeTestCoverage, type TestCoverage } from './index.js';

/**
 * Every run names the record it was laid over, so the shards of one build that
 * restored two records are told apart when they combine (`record_start.rs`).
 */

/** A run of `files` at `commit` that instrumented one module. */
function run(commit: string, files: readonly string[]): TestCoverage {
  return {
    version: 3,
    instrumentation: 'fixture',
    commit,
    tests: files.map((file) => ({ file, complete: true, preconditions: [] })),
    modules: [{
      file: 'src/a.ts',
      sourceDigest: 'source',
      instrumented: true,
      blocks: [{ ordinal: 0, kind: 'module', digest: 'root', name: '', path: '', startLine: 1, endLine: 1, source: true, testFiles: [...files].sort() }],
    }],
  };
}

/** The base part of the record at `file`, as text. */
const baseAt = (file: string) => {
  const { base } = caseSectionsAt(file) as { base?: Uint8Array };
  return base === undefined ? undefined : Buffer.from(base).toString('utf8');
};

const digestOf = (file: string) => `sha256:${createHash('sha256').update(readFileSync(file)).digest('hex')}`;

let root: string;
let record: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'variance-record-base-'));
  await writeFile(join(root, 'a.test.ts'), '');
  record = join(root, 'coverage.bin');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('the record a run started from', () => {
  it('is none for a run laid over no record', async () => {
    await landRun(record, run('head', ['a.test.ts']), root);

    expect(baseAt(record)).toBe('none');
  });

  it('is the digest of the record the first run at a commit was laid over, which later runs at that commit carry', async () => {
    await writeTestCoverage(record, run('cached', ['a.test.ts']));
    const restored = digestOf(record);

    await landRun(record, run('head', ['a.test.ts']), root);
    expect(baseAt(record)).toBe(`none over ${restored}`);
    await landRun(record, run('head', ['b.test.ts']), root);
    expect(baseAt(record)).toBe(`none over ${restored}`);

    const landed = digestOf(record);
    await landRun(record, run('next', ['a.test.ts']), root);
    expect(baseAt(record)).toBe(`none over ${landed}`);
  });

  it('names the record the selection read over the one the run was laid over, and one record when they are one', async () => {
    await writeTestCoverage(record, run('cached', ['a.test.ts']));
    const restored = digestOf(record);
    const mainline = join(root, 'mainline.bin');
    await writeTestCoverage(mainline, run('mainline', ['b.test.ts']));

    await notingRead(record, async () => ({ read: digestOf(mainline) }))();
    await landRun(record, run('head', ['a.test.ts']), root);
    expect(baseAt(record)).toBe(`${digestOf(mainline)} over ${restored}`);
    // A later run at that commit reads what the shard itself wrote, and carries the base.
    await notingRead(record, async () => ({ read: digestOf(record) }))();
    await landRun(record, run('head', ['b.test.ts']), root);
    expect(baseAt(record)).toBe(`${digestOf(mainline)} over ${restored}`);

    const fresh = join(root, 'fresh.bin');
    await notingRead(fresh, async () => ({ read: digestOf(mainline) }))();
    await landRun(fresh, run('head', ['a.test.ts']), root);
    expect(baseAt(fresh)).toBe(`${digestOf(mainline)} over none`);

    const own = join(root, 'own.bin');
    await writeTestCoverage(own, run('cached', ['a.test.ts']));
    await notingRead(own, async () => ({ read: digestOf(own) }))();
    await landRun(own, run('head', ['a.test.ts']), root);
    expect(baseAt(own)).toBe(restored);
  });

  it('fails when one start reads two records for its selection and its times, naming both', async () => {
    const mainline = join(root, 'mainline.bin');
    await writeTestCoverage(mainline, run('mainline', ['b.test.ts']));
    await writeTestCoverage(record, run('cached', ['a.test.ts']));
    const selected = digestOf(mainline);
    const timed = digestOf(record);

    await notingRead(record, async () => ({ read: selected }))();
    const times = notingRead(record, async () => ({ read: timed }));

    await expect(times()).rejects.toThrow(selected);
    await expect(times()).rejects.toThrow(timed);
  });

  it('lets a watched rerun read the record the run before it landed', async () => {
    await writeTestCoverage(record, run('cached', ['a.test.ts']));
    const restored = digestOf(record);

    await notingRead(record, async () => ({ read: restored }))();
    await landRun(record, run('head', ['a.test.ts']), root);
    await notingRead(record, async () => ({ read: digestOf(record) }))();
    await landRun(record, run('head', ['b.test.ts']), root);

    expect(baseAt(record)).toBe(restored);
  });

  it('names a record longer than it reads at once by all of its bytes', async () => {
    const long = join(root, 'long.bin');
    await writeFile(long, Buffer.alloc(3 * (1 << 20) + 7, 1));

    expect(recordDigestAt(long)).toBe(digestOf(long));
  });

  it('names no read for a run whose selection read no record', async () => {
    await writeTestCoverage(record, run('cached', ['a.test.ts']));
    const restored = digestOf(record);
    await notingRead(record, async () => ({ unread: 'nothing is recorded there' }))();

    await landRun(record, run('head', ['a.test.ts']), root);

    expect(baseAt(record)).toBe(`none over ${restored}`);
  });

  it('is named by a run that instrumented nothing and kept its cases', async () => {
    await writeTestCoverage(record, run('cached', ['a.test.ts']));
    const restored = digestOf(record);
    const sets = new CrossingSets(1);
    sets.intern([]);
    const fresh = encodeSetExecutionIndex({ tests: [{ id: 'a.test.ts > one', file: 'a.test.ts', name: 'one' }], modules: [], sets: sets.pool() });
    const uninstrumented: TestCoverage = { version: 3, instrumentation: 'fixture', commit: 'head', tests: [{ file: 'a.test.ts', complete: true, preconditions: [] }], modules: [] };

    await landRun(record, uninstrumented, root, undefined, { fresh, run: { tests: [{ file: 'a.test.ts', complete: true }], commit: 'head' } });

    expect(baseAt(record)).toBe(`none over ${restored}`);
  });

  it('does not cross to another checkout, whose runs start from the record it took', async () => {
    await landRun(record, run('head', ['a.test.ts']), root);
    const taken = join(root, 'taken.bin');
    await writeFile(taken, sharedRecord(readFileSync(record)));

    expect(baseAt(taken)).toBeUndefined();
  });
});
