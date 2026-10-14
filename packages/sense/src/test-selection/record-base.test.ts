import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { caseSectionsAt, sharedRecord } from './case-record.js';
import { landRun } from './commit-runs.js';
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
    expect(baseAt(record)).toBe(restored);
    await landRun(record, run('head', ['b.test.ts']), root);
    expect(baseAt(record)).toBe(restored);

    const landed = digestOf(record);
    await landRun(record, run('next', ['a.test.ts']), root);
    expect(baseAt(record)).toBe(landed);
  });

  it('is named by a run that instrumented nothing and kept its cases', async () => {
    await writeTestCoverage(record, run('cached', ['a.test.ts']));
    const restored = digestOf(record);
    const sets = new CrossingSets(1);
    sets.intern([]);
    const fresh = encodeSetExecutionIndex({ tests: [{ id: 'a.test.ts > one', file: 'a.test.ts', name: 'one' }], modules: [], sets: sets.pool() });
    const uninstrumented: TestCoverage = { version: 3, instrumentation: 'fixture', commit: 'head', tests: [{ file: 'a.test.ts', complete: true, preconditions: [] }], modules: [] };

    await landRun(record, uninstrumented, root, undefined, { fresh, run: { tests: [{ file: 'a.test.ts', complete: true }], commit: 'head' } });

    expect(baseAt(record)).toBe(restored);
  });

  it('does not cross to another checkout, whose runs start from the record it took', async () => {
    await landRun(record, run('head', ['a.test.ts']), root);
    const taken = join(root, 'taken.bin');
    await writeFile(taken, sharedRecord(readFileSync(record)));

    expect(baseAt(taken)).toBeUndefined();
  });
});
