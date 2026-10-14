import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { digestString } from '../digest.js';
import { layCases } from './case-landing.js';
import { caseSectionsOf } from './case-record.js';
import { encodeRecordedEyes } from './eyes-record.js';
import { encodeAsSetExecutionIndex } from './execution-set-format.js';
import { combineRecords, writeTestCoverage } from './index.js';

const source = 'export function greet() { return "hello"; }\n';
const durations: Readonly<Record<string, number>> = { 'a.test.ts': 120, 'b.test.ts': 340 };

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
});
