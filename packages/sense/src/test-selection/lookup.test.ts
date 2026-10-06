import { describe, expect, it } from 'vitest';
import { encodeTestCoverage } from './format.js';
import { openTestCoverage, type TestCoverageView } from './format-view.js';
import type { TestCoverage } from './index.js';
import { coverage, testFiles } from './__fixtures__/coverage.js';
import {
  findModule,
  findModules,
  findString,
  findTest,
  sharedPreconditions,
  testPathOf,
  testsGovernedBy,
} from './lookup.js';

const view = (): TestCoverageView => openTestCoverage(encodeTestCoverage(coverage));

const named = (
  from: TestCoverageView,
  answer: { readonly tests: ReadonlyMap<number, readonly string[]> },
): Record<string, readonly string[]> => {
  const out: Record<string, readonly string[]> = {};
  for (const [row, governing] of answer.tests) out[from.string(from.testPath.at(row))] = governing;
  return out;
};

describe('which tests a changed file governs', () => {
  it('asks nothing when nothing changed', () => {
    const answer = testsGovernedBy(view(), []);

    expect([...answer.tests]).toEqual([]);
    expect(answer.unread).toEqual([]);
  });

  it('names every test a shared input governs', () => {
    const from = view();

    expect(named(from, testsGovernedBy(from, ['vitest.config.ts']))).toEqual({
      'test/aaa.test.ts': ['vitest.config.ts'],
      'test/alpha.test.ts': ['vitest.config.ts'],
      'test/beta.test.ts': ['vitest.config.ts'],
    });
  });

  it('names one test when the input is that test own file', () => {
    const from = view();
    const answer = testsGovernedBy(from, ['test/alpha.test.ts']);

    expect(named(from, answer)).toEqual({ 'test/alpha.test.ts': ['test/alpha.test.ts'] });
    expect(answer.unread).toEqual([]);
  });

  it('returns a path no snapshot ever interned as unread rather than as governing nobody', () => {
    // The two answers are the same empty map and different sentences. A caller
    // that reads the map alone skips a suite on a file the recording has never
    // heard of.
    const answer = testsGovernedBy(view(), ['docs/guide.md']);

    expect([...answer.tests]).toEqual([]);
    expect(answer.unread).toEqual(['docs/guide.md']);
  });

  it('returns a path the dictionary holds but no test declares as unread too', () => {
    // `src/decide.ts` is interned — it is a module row — so the cheap escape of
    // *the dictionary never saw it* does not fire, and the table is scanned. It
    // still governs nobody, and the precondition table is not the place that
    // answers for it.
    const answer = testsGovernedBy(view(), ['src/decide.ts']);

    expect([...answer.tests]).toEqual([]);
    expect(answer.unread).toEqual(['src/decide.ts']);
  });

  it('separates the matched from the unmatched in one pass, in code-unit order', () => {
    const from = view();
    const answer = testsGovernedBy(from, ['zzz/never.ts', 'vitest.config.ts', 'src/decide.ts']);

    expect(named(from, answer)).toEqual({
      'test/aaa.test.ts': ['vitest.config.ts'],
      'test/alpha.test.ts': ['vitest.config.ts'],
      'test/beta.test.ts': ['vitest.config.ts'],
    });
    expect(answer.unread).toEqual(['src/decide.ts', 'zzz/never.ts']);
  });

  it('lists every input of one test, in the order the table holds them', () => {
    const from = view();
    const answer = testsGovernedBy(from, ['vitest.config.ts', 'test/beta.test.ts']);

    expect(named(from, answer)['test/beta.test.ts']).toEqual([
      'test/beta.test.ts',
      'vitest.config.ts',
    ]);
    expect(answer.unread).toEqual([]);
  });
});

describe('what the harness loads before every test', () => {
  it('is the preconditions every test declares, without each test own file', () => {
    expect(sharedPreconditions(view())).toEqual(['vitest.config.ts']);
  });

  it('leaves out a precondition one test does not declare', () => {
    const tests = coverage.tests.map((test, at) =>
      at === 0 ? test : { ...test, preconditions: [...test.preconditions, { name: 'setup.ts', digest: 'source:setup' }] });

    expect(sharedPreconditions(openTestCoverage(encodeTestCoverage({ ...coverage, tests })))).toEqual(['vitest.config.ts']);
  });

  it('names nothing for a recording with no tests', () => {
    expect(sharedPreconditions(openTestCoverage(encodeTestCoverage({ ...coverage, tests: [], modules: [] })))).toEqual([]);
  });
});

describe('finding a row by the path it was recorded under', () => {
  const twice: TestCoverage = {
    ...coverage,
    modules: [
      ...coverage.modules,
      { ...coverage.modules[1], sourceDigest: 'source:decide:other-environment' },
    ],
  };

  it('finds the one row a path has', () => {
    const from = view();
    const found = findModule(from, 'src/aaa.ts');

    expect(found).not.toBeUndefined();
    expect(from.string(from.modulePath.at(found as number))).toBe('src/aaa.ts');
  });

  it('has no row for a path the recording never read', () => {
    expect(findModule(view(), 'src/absent.ts')).toBeUndefined();
    expect(findModules(view(), 'src/absent.ts')).toEqual([]);
  });

  it('returns both rows when two builds read one file, not the one a search landed on', () => {
    // Two environments recording one module are two rows under one path. A
    // caller that reads the row a binary search lands on leaves the other
    // environment crossings on the floor, which is a skip nothing witnessed.
    const from = openTestCoverage(encodeTestCoverage(twice));
    const rows = findModules(from, 'src/decide.ts');

    expect(rows.length).toBe(2);
    for (const row of rows) expect(from.string(from.modulePath.at(row))).toBe('src/decide.ts');
    expect(rows).toContain(findModule(from, 'src/decide.ts'));
  });

  it('finds a test by its path and nothing by a modules', () => {
    const from = view();

    expect(findTest(from, 'test/beta.test.ts')).not.toBeUndefined();
    expect(findTest(from, 'src/decide.ts')).toBeUndefined();
  });
});

describe('the id a snapshot interned a string under', () => {
  it('holds every path the recording named', () => {
    const from = view();

    for (const file of [...testFiles, 'src/aaa.ts', 'src/decide.ts', 'vitest.config.ts']) {
      const id = findString(from, file);
      expect(id).not.toBeUndefined();
      expect(from.string(id as number)).toBe(file);
    }
  });

  it('declines a string it never held, which is what lets a column go unread', () => {
    expect(findString(view(), 'src/never-seen.ts')).toBeUndefined();
  });
});

describe('a row found by its path, from a lookup the view keeps', () => {
  // Forty modules, one of them read by two builds, and twenty tests: wide enough
  // that a search probes rows its neighbours' searches probed too.
  const modules = Array.from({ length: 40 }, (_, at) => `src/m${String(at).padStart(2, '0')}.ts`);
  const tests = Array.from({ length: 20 }, (_, at) => `test/t${String(at).padStart(2, '0')}.test.ts`);
  const wide: TestCoverage = {
    version: 3,
    instrumentation: 'fixture-instrumentation',
    tests: tests.map((file) => ({ file, complete: true, preconditions: [{ name: file, digest: `source:${file}` }] })),
    modules: [...modules, 'src/m17.ts'].map((file, at) => ({
      file,
      sourceDigest: `source:${file}:${at}`,
      instrumented: true,
      blocks: [],
    })),
  };
  // Before the first, between two, after the last, a prefix of one, and one
  // name for each table that is the other table's.
  const absent = ['a.ts', 'src/m17.tsx', 'src/m1.ts', 'src/m99.ts', 'zzz.ts', 'test/t05.test.tsx'];

  /** The answers a decode of every row gives, which a lookup has to agree with. */
  const scanned = (from: TestCoverageView, file: string): { modules: number[]; test: number | undefined } => {
    const rows: number[] = [];
    for (let row = 0; row < from.modulePath.length; row += 1) {
      if (from.string(from.modulePath.at(row)) === file) rows.push(row);
    }
    let test: number | undefined;
    for (let row = 0; row < from.testPath.length; row += 1) {
      if (from.string(from.testPath.at(row)) === file) test = row;
    }
    return { modules: rows, test };
  };

  it('answers every path, held or absent, as a decode of every row does, in whichever order it is asked', () => {
    const reference = openTestCoverage(encodeTestCoverage(wide));
    const from = openTestCoverage(encodeTestCoverage(wide));
    const asked = [...modules, ...tests, ...absent];

    for (const file of [...asked, ...[...asked].reverse()]) {
      const { modules: rows, test } = scanned(reference, file);
      expect(findModules(from, file)).toEqual(rows);
      expect(findModule(from, file) === undefined).toBe(rows.length === 0);
      expect(findTest(from, file)).toBe(test);
    }
    expect(findModules(from, 'src/m17.ts')).toHaveLength(2);
    for (const file of absent) {
      expect(findModules(from, file)).toEqual([]);
      expect(findTest(from, file)).toBeUndefined();
    }
  });

  it('decodes each row it probes once per view, however many lookups probe it', () => {
    const opened = openTestCoverage(encodeTestCoverage(wide));
    let decoded = 0;
    const from: TestCoverageView = {
      ...opened,
      string: (id) => {
        decoded += 1;
        return opened.string(id);
      },
    };

    for (let pass = 0; pass < 3; pass += 1) {
      for (const file of [...modules, ...tests, ...absent]) {
        findModules(from, file);
        findTest(from, file);
      }
    }

    expect(decoded).toBeLessThanOrEqual(from.modulePath.length + from.testPath.length);
  });

  it('names a test row by its path, decoded once per view', () => {
    const opened = openTestCoverage(encodeTestCoverage(wide));
    let decoded = 0;
    const from: TestCoverageView = {
      ...opened,
      string: (id) => {
        decoded += 1;
        return opened.string(id);
      },
    };

    for (let pass = 0; pass < 2; pass += 1) {
      expect(tests.map((_, row) => testPathOf(from, row))).toEqual(tests);
    }
    expect(decoded).toBe(tests.length);
  });
});
