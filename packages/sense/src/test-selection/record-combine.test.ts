import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { digestString } from '../digest.js';
import { lastCaseRunOf, layCases } from './case-landing.js';
import { caseSectionsOf, withCaseSections } from './case-record.js';
import { encodeRecordedEyes } from './eyes-record.js';
import { decodeExecutionIndex } from './execution-format.js';
import { encodeAsSetExecutionIndex } from './execution-set-format.js';
import { landRun } from './commit-runs.js';
import { INSTRUMENTATION_ID } from '../instrument/index.js';
import { combineRecords, readTestCoverage, sourceCut, writeTestCoverage } from './index.js';
import { notingRead } from './record-base.js';
import { timesFrom } from './selection-environment.js';

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
 * The cases of `overwritten` ran `greet` in a text an edit wrote over, as a
 * layering cut to the edited text keeps them (`landedThrough`).
 */
async function recordOf(name: string, files: readonly string[], overwritten: readonly string[] = []): Promise<string> {
  const tests = files.map((file) => ({ id: `${file} > greets`, file, name: 'greets', stopped: false }));
  const blocks = [
    { ordinal: 0, kind: 'module' as const, digest: 'module', name: '', path: '', startLine: 1, endLine: 1, source: true, testFiles: [], loadedBy: [...files] },
    { ordinal: 1, owner: 0, kind: 'function' as const, digest: 'function', name: 'greet', path: 'greet', startLine: 1, endLine: 1, source: true, testFiles: [...files] },
  ];
  const modules = [{ file: 'src/greet.ts', sourceDigest: digestString(source), instrumented: true, blocks }];
  const fresh = encodeAsSetExecutionIndex({
    tests,
    modules: [{ file: 'src/greet.ts', blocks: blocks.map((block) => ({
      ...block, crossings: block.kind === 'function'
        ? tests.map(({ file }, test) => ({ test, distance: 0, ...(overwritten.includes(file) ? { overwritten: true as const } : {}) }))
        : [],
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
      combineRecords(named, into, root);
      const combined = await readFile(into);
      expect(readable(combined)).toEqual(readable(whole));
      expect(Buffer.compare(combined, whole)).toBe(0);
    }
  });

  it('carries a case a shard ran over another text of a region as overwritten, never as absent', async () => {
    const shards = [await recordOf('a.bin', ['a.test.ts'], ['a.test.ts']), await recordOf('b.bin', ['b.test.ts'])];
    const into = join(root, 'combined.bin');
    combineRecords(shards, into, root);
    const index = decodeExecutionIndex(caseSectionsOf(await readFile(into)).index!);
    const greet = index.modules[0]!.blocks.find((block) => block.name === 'greet')!;
    // The case index lists a region's called cases before its overwritten ones.
    expect(greet.crossings.map(({ test, overwritten }) => [index.tests[test]!.file, overwritten === true])).toEqual([
      ['b.test.ts', false],
      ['a.test.ts', true],
    ]);
  });

  it('folds legacy and compact last-run membership into the unsharded spelling', async () => {
    const whole = await readFile(await recordOf('whole.bin', ['a.test.ts', 'b.test.ts']));
    const shards = [await recordOf('a.bin', ['a.test.ts']), await recordOf('b.bin', ['b.test.ts'])];
    const bytes = await readFile(shards[0]!);
    const parts = caseSectionsOf(bytes);
    await writeFile(shards[0]!, withCaseSections(bytes, { ...parts, last: Buffer.from(JSON.stringify(lastCaseRunOf(parts))) }));
    const into = join(root, 'combined.bin');
    combineRecords(shards, into, root);
    expect(readable(await readFile(into))).toEqual(readable(whole));
  });

  it('refuses malformed or unresolved compact membership before writing a combined record', async () => {
    const shard = await recordOf('a.bin', ['a.test.ts']);
    const bytes = await readFile(shard);
    const parts = caseSectionsOf(bytes);
    const named = lastCaseRunOf(parts)!;
    for (const references of [[99], [-1], [0.5]]) {
      await writeFile(shard, withCaseSections(bytes, { ...parts, last: Buffer.from(JSON.stringify({ ...named, cases: { references } })) }));
      expect(() => combineRecords([shard], join(root, 'combined.bin'), root)).toThrow(/last-run layer/u);
    }
  });

  it('refuses a file two shards both recorded, such as a setup project every Playwright shard runs, naming both', async () => {
    const shards = [await recordOf('a.bin', ['a.test.ts']), await recordOf('ab.bin', ['a.test.ts', 'b.test.ts'])];

    expect(() => combineRecords(shards, join(root, 'combined.bin'))).toThrow(
      /`a\.test\.ts` was recorded by .*a\.bin and again by .*ab\.bin\. A test file belongs to one shard/u,
    );
  });

  it('folds back the last-run layer and Eyes a landing wrote, byte for byte', async () => {
    const recorded = await recordOf('one.bin', ['a.test.ts', 'b.test.ts']);
    const into = join(root, 'combined.bin');
    combineRecords([recorded], into, root);
    const [before, after] = [caseSectionsOf(await readFile(recorded)), caseSectionsOf(await readFile(into))];

    expect(before.last).toBeDefined();
    expect(Buffer.from(after.last!).toString()).toBe(Buffer.from(before.last!).toString());
    expect(Buffer.from(after.eyes!).toString()).toBe(Buffer.from(before.eyes!).toString());
    expect(Buffer.from(after.eyes!).toString()).toBe(Buffer.from(encodeRecordedEyes({
      watched: ['a.test.ts > greets', 'b.test.ts > greets'],
      journals: ['a.test.ts', 'b.test.ts'].map((file) => ({ case: `${file} > greets`, attempt: 1, journal: { shots: [`${file}.png`], closed: true } })),
    })).toString());
  });

  it('carries the readings each shard kept of its cases into the combined record', async () => {
    const shards = [await recordOf('a.bin', ['a.test.ts']), await recordOf('b.bin', ['b.test.ts'])];
    const kept = (file: string) => ({ cases: { [`${file} > greets`]: [{ count: 1, stopped: false }, { count: 2, stopped: true, gone: [0] }] } });
    for (const [shard, file] of [[shards[0]!, 'a.test.ts'], [shards[1]!, 'b.test.ts']] as const) {
      const bytes = await readFile(shard);
      await writeFile(shard, withCaseSections(bytes, { ...caseSectionsOf(bytes), readings: Buffer.from(JSON.stringify(kept(file))) }));
    }
    const into = join(root, 'combined.bin');
    combineRecords(shards, into, root);

    expect(JSON.parse(Buffer.from(caseSectionsOf(await readFile(into)).readings!).toString())).toEqual({ cases: { ...kept('a.test.ts').cases, ...kept('b.test.ts').cases } });
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
      expect(() => combineRecords(shards, join(root, 'combined.bin'), root)).toThrow(
        `the build failed because the sharding was unstable: ${shards[0]} started from ${named(first)}, and ${shards[1]} from ${named(second)}.`,
      );
    }
    expect(combineRecords(await shardsOver([two, two]), join(root, 'combined.bin'), root).shards).toHaveLength(2);
  });

  // The documented recipe: shards of a run that selects nothing record into
  // fresh artifacts, each placing its files by the times of the record it read.
  it('fails the build when two shards chose their tests from two records, and passes two that read one', async () => {
    const cached = async (name: string, duration: number) => {
      const path = join(root, name);
      await writeTestCoverage(path, { version: 3, instrumentation: 'fixture', commit: 'cached', tests: [{ file: 'a.test.ts', complete: true, preconditions: [], duration }], modules: [] });
      return path;
    };
    const [one, two] = [await cached('one.bin', 120), await cached('two.bin', 340)];
    const shardsReading = async (read: readonly string[], fresh: string) =>
      Promise.all(['a.test.ts', 'b.test.ts'].map(async (file, at) => {
        const shard = join(root, `${fresh}-${at}.bin`);
        await notingRead(shard, timesFrom({ root, recording: read[at]! }))();
        await landRun(shard, { version: 3, instrumentation: 'fixture', commit: 'c0ffee', tests: [{ file, complete: true, preconditions: [] }], modules: [moduleOf(file)] }, root);
        return shard;
      }));
    const named = async (path: string) => `the record sha256:${createHash('sha256').update(await readFile(path)).digest('hex').slice(0, 12)}`;

    const apart = await shardsReading([one, two], 'apart');
    const failed = (() => { try { combineRecords(apart, join(root, 'apart.bin'), root); } catch (error) { return (error as Error).message; } })();
    expect(failed).toContain(`the build failed because the sharding was unstable: ${apart[0]} chose its tests from ${await named(one)}, and ${apart[1]} from ${await named(two)}.`);
    expect(failed).toContain('Nothing of this build is combined, so the record before it stands. Shards choose alike when every one reads the same record');

    const together = await shardsReading([one, one], 'together');
    expect(combineRecords(together, join(root, 'together.bin'), root).shards).toHaveLength(2);
  });
});

describe('combineRecords over shards that cut one text two ways', () => {
  const twice = 'export function both(run: (step: () => number) => void) {\n  run(() => 1);\n  run(() => 2);\n}\n';

  /** Two shards over `src/twice.ts`: one cut as this build cuts it, one carrying a row an older writer described otherwise. */
  async function disputedShards(): Promise<readonly string[]> {
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src/twice.ts'), twice);
    const cut = sourceCut(twice, 'src/twice.ts', 'presence')!;
    const shard = async (name: string, file: string, digest: (block: number) => string | undefined) => {
      const path = join(root, name);
      const blocks = cut.rows.map((row, at) => ({ ...row, digest: digest(at) ?? row.digest, testFiles: [file] }));
      await writeTestCoverage(path, {
        version: 3, instrumentation: INSTRUMENTATION_ID, commit: 'c0ffee',
        tests: [{ file, complete: true, preconditions: [], duration: 1 }],
        modules: [{ file: 'src/twice.ts', sourceDigest: cut.sourceDigest, instrumented: true, blocks }],
      });
      return path;
    };
    return [await shard('fresh.bin', 'a.test.ts', () => undefined), await shard('carried.bin', 'b.test.ts', (at) => (at === 1 ? 'older' : undefined))];
  }

  it('cuts the module again in the checkout and folds both shards onto that cut', async () => {
    const shards = await disputedShards();
    const output = join(root, 'combined.bin');
    expect(combineRecords(shards, output, root).tests).toBe(2);
    const [module] = (await readTestCoverage(output)).modules;
    expect(module!.blocks.map((block) => block.digest)).toEqual(sourceCut(twice, 'src/twice.ts', 'presence')!.rows.map((row) => row.digest));
    expect(module!.blocks.every((block) => block.testFiles.join() === 'a.test.ts,b.test.ts')).toBe(true);
  });

  it('refuses a module the checkout no longer holds', async () => {
    const shards = await disputedShards();
    await rm(join(root, 'src/twice.ts'));
    expect(() => combineRecords(shards, join(root, 'combined.bin'), root)).toThrow('the checkout holds no text of `src/twice.ts`');
  });
});
