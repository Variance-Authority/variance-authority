import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import journals from './journal-format.cjs';
import type { CapturedModule } from './instrumented-modules.js';
import { foldRun, runJournals, testsOfJournals } from './run-fold.js';

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'va-run-fold-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

/** A module of `regions` regions, with or without probes to say what ran. */
const module = (id: string, regions: number, instrumented = true): CapturedModule =>
  ({
    file: id,
    id,
    sourceDigest: 'digest',
    instrumented,
    blocks: Array.from({ length: regions }, (_, ordinal) => ({ ordinal })),
  }) as unknown as CapturedModule;

/** One worker's frame: which regions of which modules a test file entered. */
async function frame(name: string, test: string, entered: Record<string, number[]>, before: Record<string, number[]> = {}) {
  const counters = (hits: readonly number[], regions: number): Uint32Array => {
    const held = new Uint32Array(regions);
    for (const ordinal of hits) held[ordinal] = 1;
    return held;
  };
  const enteredMap = new Map(Object.entries(entered).map(([id, hits]) => [id, counters(hits, 4)]));
  const beforeMap = new Map(Object.entries(before).map(([id, hits]) => [id, counters(hits, 4)]));
  const path = join(directory, name);
  await writeFile(path, journals.encodeJournal(test, enteredMap, beforeMap));
  return path;
}

const name = (file: string): string => file.replace(/^\/repo\//, '');

describe('runJournals', () => {
  it('counts a run directory that was never written as a run with no frames', async () => {
    expect(await runJournals(join(directory, 'never'))).toEqual([]);
  });

  it('lists the frames in a stable order whatever order the disk returns them in', async () => {
    await writeFile(join(directory, 'b.journal'), '');
    await writeFile(join(directory, 'a.journal'), '');
    expect(await runJournals(directory)).toEqual([join(directory, 'a.journal'), join(directory, 'b.journal')]);
  });
});

describe('testsOfJournals', () => {
  it('numbers the test files the frames name, once each, in code-unit order', async () => {
    const paths = [
      await frame('1', '/repo/z.test.ts', { 'm.ts': [0] }),
      await frame('2', '/repo/a.test.ts', { 'm.ts': [1] }),
      await frame('3', '/repo/z.test.ts', { 'm.ts': [2] }),
    ];
    expect(testsOfJournals(paths, name)).toEqual(['a.test.ts', 'z.test.ts']);
  });
});

describe('foldRun', () => {
  it('names the tests that entered a region, and those that had entered it before their first test ran', async () => {
    const modules = new Map([['lib.ts', module('lib.ts', 3)]]);
    const paths = [
      await frame('1', '/repo/a.test.ts', { 'lib.ts': [0, 1] }, { 'lib.ts': [0] }),
      await frame('2', '/repo/b.test.ts', { 'lib.ts': [1] }),
    ];
    const tests = testsOfJournals(paths, name);
    const fold = foldRun({ directory, name, modules }, paths, tests);

    expect(fold.tests).toEqual(['a.test.ts', 'b.test.ts']);
    expect(fold.passes).toBe(1);
    expect(fold.crossers('lib.ts', 0)).toEqual(['a.test.ts']);
    expect(fold.crossers('lib.ts', 1)).toEqual(['a.test.ts', 'b.test.ts']);
    expect(fold.crossers('lib.ts', 2)).toEqual([]);
    expect(fold.loadedBy('lib.ts', 0)).toEqual(['a.test.ts']);
    expect(fold.loadedBy('lib.ts', 1)).toEqual([]);
  });

  it('answers with nothing for a module the run has no record of, or an ordinal it does not have', async () => {
    const modules = new Map([['lib.ts', module('lib.ts', 2)]]);
    const paths = [await frame('1', '/repo/a.test.ts', { 'lib.ts': [0] })];
    const fold = foldRun({ directory, name, modules }, paths, ['a.test.ts']);

    expect(fold.crossers('other.ts', 0)).toEqual([]);
    expect(fold.crossers('lib.ts', 9)).toEqual([]);
    expect(fold.crossers('lib.ts', -1)).toEqual([]);
  });

  it('keeps the modules a test entered that no probe can see inside, as that test’s preconditions', async () => {
    const modules = new Map([
      ['lib.ts', module('lib.ts', 2)],
      ['vendor.js', module('vendor.js', 0, false)],
    ]);
    const paths = [
      await frame('1', '/repo/a.test.ts', { 'lib.ts': [0], 'vendor.js': [] }),
      await frame('2', '/repo/b.test.ts', { 'lib.ts': [0] }),
    ];
    const fold = foldRun({ directory, name, modules }, paths, testsOfJournals(paths, name));

    expect(fold.uninstrumented('a.test.ts')).toEqual(['vendor.js']);
    expect(fold.uninstrumented('b.test.ts')).toEqual([]);
    expect(fold.uninstrumented('never-ran.test.ts')).toEqual([]);
  });

  it('gives the same answer when the budget forces the frames to be read again per slice', async () => {
    const modules = new Map([
      ['one.ts', module('one.ts', 2)],
      ['two.ts', module('two.ts', 2)],
    ]);
    const paths = [
      await frame('1', '/repo/a.test.ts', { 'one.ts': [0], 'two.ts': [1] }),
      await frame('2', '/repo/b.test.ts', { 'one.ts': [1], 'two.ts': [1] }),
    ];
    const tests = testsOfJournals(paths, name);
    const whole = foldRun({ directory, name, modules }, paths, tests);
    const sliced = foldRun({ directory, name, modules, budget: 1 }, paths, tests);

    expect(sliced.passes).toBeGreaterThan(whole.passes);
    for (const id of ['one.ts', 'two.ts']) {
      for (const ordinal of [0, 1]) {
        expect(sliced.crossers(id, ordinal)).toEqual(whole.crossers(id, ordinal));
        expect(sliced.loadedBy(id, ordinal)).toEqual(whole.loadedBy(id, ordinal));
      }
    }
  });
});
