import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decodeRecordedAttempts, encodeRecordedAttempts, type RecordedAttempt } from './attempts-record.js';
import { landCases } from './case-landing.js';
import { encodeAsSetExecutionIndex } from './execution-set-format.js';
import { writeTestCoverage } from './index.js';

const files = ['a.test.ts', 'b.test.ts'];
const id = (file: string): string => `${file} > greets`;
const retried = (file: string): RecordedAttempt[] => [
  { case: id(file), attempt: 1, ended: 'failed', duration: 2, message: 'expected hello' },
  { case: id(file), attempt: 2, ended: 'passed', duration: 1 },
];

/** A case index of one case a file, each calling `greet`. */
function index(of: readonly string[]): Uint8Array {
  const tests = of.map((file) => ({ id: id(file), file, name: 'greets', stopped: false }));
  const block = { ordinal: 0, kind: 'function' as const, digest: 'function', name: 'greet', path: 'greet', startLine: 1, endLine: 1, source: true };
  return encodeAsSetExecutionIndex({
    tests,
    modules: [{ file: 'src/greet.ts', blocks: [{ ...block, crossings: tests.map((_, test) => ({ test, distance: 0 })) }] }],
  });
}

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'variance-landing-attempts-'));
  for (const file of files) await writeFile(join(root, file), '');
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A shard that ran `file`, and the attempts its seam kept; `undefined` when it kept none. Its seed carried the cases of `carried`. */
async function shard(file: string, attempts: readonly RecordedAttempt[] | undefined, carried: readonly string[] = []) {
  const path = join(root, `${file}.bin`);
  await writeTestCoverage(path, { version: 3, instrumentation: 'fixture', tests: [], modules: [] }, {
    index: index([...carried, file]),
    ...(attempts === undefined ? {} : { attempts: encodeRecordedAttempts(attempts) }),
  });
  return { path, coverage: { commit: 'c0ffee', tests: [{ file, complete: true }], modules: [{ file: 'src/greet.ts', sourceDigest: 'v1:base' }] } };
}

/** The attempts a landing of `shards` leaves over a record of both files that held `held`. */
function landed(shards: Awaited<ReturnType<typeof shard>>[], held?: readonly RecordedAttempt[]) {
  const previous = { index: index(files), ...(held === undefined ? {} : { attempts: encodeRecordedAttempts(held) }) };
  const { sections } = landCases(join(root, 'coverage.bin'), previous, root, shards, new Map([['src/greet.ts', 'v1:base']]));
  return sections.attempts === undefined ? undefined : decodeRecordedAttempts(sections.attempts);
}

describe('the attempts a landing leaves over a record that kept none', () => {
  it('are kept once its shards together ran every case the record holds', async () => {
    expect(landed([await shard('a.test.ts', []), await shard('b.test.ts', retried('b.test.ts'))])).toEqual(retried('b.test.ts'));
    expect(landed([await shard('b.test.ts', retried('b.test.ts')), await shard('a.test.ts', [])])).toEqual(retried('b.test.ts'));
  });

  it('are not kept while a case of the record ran in none of its shards, carried by a shard\'s seed or not', async () => {
    expect(landed([await shard('b.test.ts', retried('b.test.ts'))])).toBeUndefined();
    expect(landed([await shard('b.test.ts', retried('b.test.ts'), ['a.test.ts'])])).toBeUndefined();
  });
});

describe('the attempts a landing leaves when a shard that ran cases kept none', () => {
  it('are not kept, whichever shard came first and whatever the record held', async () => {
    const [kept, none] = [await shard('b.test.ts', retried('b.test.ts')), await shard('a.test.ts', undefined)];
    expect(landed([none, kept])).toBeUndefined();
    expect(landed([kept, none])).toBeUndefined();
    expect(landed([none, kept], retried('a.test.ts'))).toBeUndefined();
  });
  it('are kept beside a shard that ran no case, and so had none to keep', async () => {
    const idle = { ...(await shard('a.test.ts', undefined)), coverage: { commit: 'c0ffee', tests: [], modules: [] } };
    expect(landed([idle, await shard('b.test.ts', [])], retried('a.test.ts'))).toEqual(retried('a.test.ts'));
  });
});

describe('the attempts a landing leaves over a record that kept them', () => {
  it('are the record\'s for a case no shard ran, and the shard\'s for one it ran', async () => {
    expect(landed([await shard('b.test.ts', [])], [...retried('a.test.ts'), ...retried('b.test.ts')])).toEqual(retried('a.test.ts'));
  });
});
