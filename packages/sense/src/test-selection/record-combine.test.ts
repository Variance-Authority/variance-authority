import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { digestString } from '../digest.js';
import { layCases } from './case-landing.js';
import { caseSectionsOf } from './case-record.js';
import { encodeRecordedEyes } from './eyes-record.js';
import { encodeAsSetExecutionIndex } from './execution-set-format.js';
import { landRun } from './commit-runs.js';
import { combineRecords, writeTestCoverage } from './index.js';

const source = 'export function greet() { return "hello"; }\n';
const durations: Readonly<Record<string, number>> = { 'a.test.ts': 120, 'b.test.ts': 340 };
/** `src/greet.ts` as a run of `file` alone entered it. */
const moduleOf = (file: string) => ({
  file: 'src/greet.ts', sourceDigest: digestString(source), instrumented: true,
  blocks: [{ ordinal: 0, kind: 'module' as const, digest: 'module', name: '', path: '', startLine: 1, endLine: 1, source: true, testFiles: [file] }],
});

let root: string;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-15T00:00:00.000Z'));
  root = await mkdtemp(join(tmpdir(), 'variance-record-combine-'));
  for (const file of Object.keys(durations)) await writeFile(join(root, file), 'it("greets", () => {});\n');
});
afterEach(async () => {
  vi.useRealTimers();
  await rm(root, { recursive: true, force: true });
});

/**
 * The record one run of `files` writes, every part of it through the
 * TypeScript writers: the coverage through `format.ts`, the case index and the
 * last-run layer through `case-landing.ts`, and Eyes through `eyes-record.ts`.
 */
async function recordOf(name: string, files: readonly string[]): Promise<string> {
  const tests = files.map((file) => ({ id: `${file} > greets`, file, name: 'greets', stopped: false }));
  const blocks = [
    { ordinal: 0, kind: 'module' as const, digest: 'module', name: '', path: '', startLine: 1, endLine: 1, source: true, testFiles: [], loadedBy: [...files] },
    { ordinal: 1, owner: 0, kind: 'function' as const, digest: 'function', name: 'greet', path: 'greet', startLine: 1, endLine: 1, source: true, testFiles: [...files] },
  ];
  const modules = [{ file: 'src/greet.ts', sourceDigest: digestString(source), instrumented: true, blocks }];
  const fresh = encodeAsSetExecutionIndex({
    tests,
    modules: [{ file: 'src/greet.ts', blocks: blocks.map((block) => ({
      ...block, crossings: block.kind === 'function' ? tests.map((_, test) => ({ test, distance: 0 })) : [],
    })) }],
  });
  const eyes = {
    watched: tests.map((test) => test.id),
    journals: tests.map((test) => ({ case: test.id, attempt: 1, journal: { shots: [`${test.file}.png`], closed: true } })),
  };
  const run = { commit: 'c0ffee', tests: files.map((file) => ({ file, complete: true })), modules };
  const cases = layCases({}, fresh, root, run, eyes);
  const path = join(root, name);
  await writeTestCoverage(path, {
    version: 3, instrumentation: 'fixture', commit: 'c0ffee',
    tests: files.map((file) => ({ file, complete: true, preconditions: [], duration: durations[file]! })),
    modules,
  }, cases);
  return path;
}

/** A record's case parts as text, so a difference reads as the part it is in. */
function readable(record: Buffer): Record<string, string> {
  return Object.fromEntries(Object.entries(caseSectionsOf(record)).map(([part, bytes]) => {
    const held = Buffer.from(bytes!);
    return [part, part === 'last' || part === 'eyes' ? held.toString() : held.toString('hex')];
  }));
}

describe('combineRecords against the TypeScript writers', () => {
  // The determinism and equivalence test: shards of one run, combined in the
  // addon, are the bytes the TypeScript encoders write for the unsharded run.
  it('writes, from two shards in either order, the bytes the unsharded run writes', async () => {
    const whole = await readFile(await recordOf('whole.bin', ['a.test.ts', 'b.test.ts']));
    const shards = [await recordOf('a.bin', ['a.test.ts']), await recordOf('b.bin', ['b.test.ts'])];

    for (const named of [shards, [...shards].reverse()]) {
      const into = join(root, `combined-${named.length}-${named[0]!.endsWith('a.bin') ? 'ab' : 'ba'}.bin`);
      combineRecords(named, into);
      const combined = await readFile(into);
      expect(readable(combined)).toEqual(readable(whole));
      expect(Buffer.compare(combined, whole)).toBe(0);
    }
  });

  it('folds back the last-run layer and Eyes a landing wrote, byte for byte', async () => {
    const recorded = await recordOf('one.bin', ['a.test.ts', 'b.test.ts']);
    const into = join(root, 'combined.bin');
    combineRecords([recorded], into);
    const [before, after] = [caseSectionsOf(await readFile(recorded)), caseSectionsOf(await readFile(into))];

    expect(before.last).toBeDefined();
    expect(Buffer.from(after.last!).toString()).toBe(Buffer.from(before.last!).toString());
    expect(Buffer.from(after.eyes!).toString()).toBe(Buffer.from(before.eyes!).toString());
    expect(Buffer.from(after.eyes!).toString()).toBe(Buffer.from(encodeRecordedEyes({
      watched: ['a.test.ts > greets', 'b.test.ts > greets'],
      journals: ['a.test.ts', 'b.test.ts'].map((file) => ({ case: `${file} > greets`, attempt: 1, journal: { shots: [`${file}.png`], closed: true } })),
    })).toString());
  });

  // Each shard restores the cached record and runs over it; a shard's record
  // names the record its run was laid over, which it split the suite by.
  it('fails the build when the shards split the suite by different records, in either order', async () => {
    // Two cached records that hold no test file either shard runs, so neither
    // shard carries a row the other one records.
    const cached = async (name: string, sourceDigest: string) => {
      const path = join(root, name);
      await writeTestCoverage(path, { version: 3, instrumentation: 'fixture', commit: 'cached', tests: [], modules: [{ file: 'src/c.ts', sourceDigest, instrumented: false, blocks: [] }] });
      return readFile(path);
    };
    const [one, two] = [await cached('one.bin', 'yesterday'), await cached('two.bin', 'today')];
    const shardsOver = async (restored: readonly Buffer[]) =>
      Promise.all(['a.test.ts', 'b.test.ts'].map(async (file, at) => {
        const shard = join(root, `shard-${at}.bin`);
        await writeFile(shard, restored[at]!);
        await landRun(shard, { version: 3, instrumentation: 'fixture', commit: 'c0ffee', tests: [{ file, complete: true, preconditions: [] }], modules: [moduleOf(file)] }, root);
        return shard;
      }));
    const named = (bytes: Buffer) => `the record sha256:${createHash('sha256').update(bytes).digest('hex').slice(0, 12)}`;
    for (const [first, second] of [[one, two], [two, one]] as const) {
      const shards = await shardsOver([first, second]);
      expect(() => combineRecords(shards, join(root, 'combined.bin'))).toThrow(
        `the build failed because the sharding was unstable: ${shards[0]} started from ${named(first)}, and ${shards[1]} from ${named(second)}.`,
      );
    }
    expect(combineRecords(await shardsOver([two, two]), join(root, 'combined.bin')).shards).toHaveLength(2);
  });
});
