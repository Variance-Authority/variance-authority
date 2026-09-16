// The layer against the composition it replaces, case by case.
//
// `layerTestCoverage` is `encodeTestCoverage(mergeCoverage(decode(bytes), …))`
// with the decode and most of the encode removed, and it is only worth having
// while the two are the same bytes. So every case the merge distinguishes is
// run through both and compared as a buffer: not the model it decodes to, the
// file. A rule added to the merge and not to the layer fails here rather than
// in an index somebody has already written.

import { describe, expect, it } from 'vitest';
import { encodeTestCoverage } from './format.js';
import { layerTestCoverage } from './format-layer.js';
import { mergeCoverage } from './merge.js';
import type { CoverageBlock, TestCoverage } from './index.js';

const BASELINE = '1111111111111111111111111111111111111111';
const LOCAL = '2222222222222222222222222222222222222222';
const DECIDE = 'export function decide(n) {\n  return n > 0;\n}\n';

function root(digest: string, testFiles: readonly string[]): CoverageBlock {
  return {
    ordinal: 0,
    kind: 'module',
    digest,
    name: '',
    path: 'module',
    startLine: 1,
    endLine: 8,
    source: true,
    testFiles: [...testFiles],
  };
}

function entry(digest: string, testFiles: readonly string[]): CoverageBlock {
  return {
    ordinal: 1,
    kind: 'function',
    owner: 0,
    digest,
    name: 'decide',
    path: 'entry',
    startLine: 1,
    endLine: 3,
    source: true,
    testFiles: [...testFiles],
  };
}

/** A snapshot of `files`, each module entered by `test`, positioned at `commit`. */
function at(
  commit: string | undefined,
  test: string,
  files: readonly string[] = ['src/decide.ts'],
  complete = true,
): TestCoverage {
  return {
    version: 3,
    instrumentation: 'fixture-instrumentation',
    ...(commit === undefined ? {} : { commit }),
    tests: [{ file: test, complete, preconditions: [{ name: test, digest: 'source:test' }] }],
    modules: files.map((file) => ({
      file,
      sourceDigest: `source:${file}`,
      instrumented: true,
      blocks: [root(`block:${file}`, [test]), entry(`block:${file}-entry`, [test])],
    })),
  };
}

/** The same snapshot with every region's digest moved: the module was edited. */
function rewritten(coverage: TestCoverage): TestCoverage {
  return {
    ...coverage,
    modules: coverage.modules.map((module) => ({
      ...module,
      sourceDigest: `${module.sourceDigest}-edited`,
      blocks: module.blocks.map((block) => ({ ...block, digest: `${block.digest}-edited` })),
    })),
  };
}

/**
 * The same snapshot with the module's own region marked as entered before the
 * test began: the second crossing list, which rides on every row beside the
 * first and has to be carried, retired and re-cut exactly as the first is.
 */
function loadedEarly(coverage: TestCoverage): TestCoverage {
  const early = coverage.tests.map((test) => test.file);

  return {
    ...coverage,
    modules: coverage.modules.map((module) => ({
      ...module,
      blocks: module.blocks.map((block, at) => (at === 0 ? { ...block, loadedBy: early } : block)),
    })),
  };
}

/**
 * Two tests crossing every region, one of which was already in the process when
 * the other began: the loaded set is a proper subset of the crossing set rather
 * than the whole of it.
 *
 * Every other loaded fixture here has one test, so its loaders and its crossers
 * are the same set and name the same pool entry. This is the case where they do
 * not: the second reference is a second entry, interned in the order the regions
 * are written, and a merge that retires either test has to re-cut both.
 */
function loadedByOne(commit: string | undefined, files: readonly string[]): TestCoverage {
  const both = ['test/alpha.test.ts', 'test/beta.test.ts'];
  return {
    version: 3,
    instrumentation: 'fixture-instrumentation',
    ...(commit === undefined ? {} : { commit }),
    tests: both.map((file) => ({
      file,
      complete: true,
      preconditions: [{ name: file, digest: 'source:test' }],
    })),
    modules: files.map((file) => ({
      file,
      sourceDigest: `source:${file}`,
      instrumented: true,
      blocks: [
        { ...root(`block:${file}`, both), loadedBy: ['test/alpha.test.ts'] },
        entry(`block:${file}-entry`, both),
      ],
    })),
  };
}

/**
 * One path read by two builds: two rows under `src/decide.ts`, each built from
 * its own text and crossed by its own suite.
 *
 * The case the merge has to distinguish is a run that re-records one of them.
 * The other build was not observed, so its row is carried — and a layer that
 * placed the previous rows of a path by the first of them would drop it.
 */
function twoBuilds(commit: string | undefined, first: string, second: string): TestCoverage {
  const left = at(commit, first);
  const right = at(commit, second);
  return {
    ...left,
    tests: [...left.tests, ...right.tests],
    modules: [
      left.modules[0]!,
      { ...right.modules[0]!, sourceDigest: 'source:src/decide.ts-webkit' },
    ],
  };
}

/**
 * A module whose two regions answer to one address, entered by one test each.
 *
 * A call-argument closure is named after the callee it is an argument to, so
 * two of them in a scope are both `decide/map.arg0` at `entry`. The carry is by
 * address, and this is the shape where the address does not tell the two rows
 * apart: region `n` is entered by `entered[n]`.
 */
function twins(
  commit: string | undefined,
  entered: readonly (readonly string[])[],
): TestCoverage {
  return {
    version: 3,
    instrumentation: 'fixture-instrumentation',
    ...(commit === undefined ? {} : { commit }),
    tests: [...new Set(entered.flat())].sort().map((file) => ({
      file,
      complete: true,
      preconditions: [{ name: file, digest: 'source:test' }],
    })),
    modules: [{
      file: 'src/decide.ts',
      sourceDigest: 'source:src/decide.ts',
      instrumented: true,
      blocks: [
        root('block:src/decide.ts', entered[0] ?? []),
        { ...entry('block:src/decide.ts-arg0', entered[1] ?? []), name: 'decide/map.arg0' },
        {
          ...entry('block:src/decide.ts-arg0-twin', entered[2] ?? []),
          ordinal: 2,
          name: 'decide/map.arg0',
          startLine: 5,
          endLine: 7,
        },
      ],
    }],
  };
}

const WIDE = ['src/alpha.ts', 'src/decide.ts', 'src/zeta.ts'];

interface Case {
  readonly previous: TestCoverage | undefined;
  readonly current: TestCoverage;
  readonly onDisk?: ReadonlyMap<string, string>;
}

const CASES: Readonly<Record<string, Case>> = {
  'nothing underneath': {
    previous: undefined,
    current: at(LOCAL, 'test/beta.test.ts'),
  },
  'a baseline recorded under another probe recipe': {
    previous: { ...at(BASELINE, 'test/alpha.test.ts'), instrumentation: 'another-recipe' },
    current: at(LOCAL, 'test/beta.test.ts'),
  },
  'a run that re-recorded the module it found': {
    previous: at(BASELINE, 'test/alpha.test.ts'),
    current: at(LOCAL, 'test/beta.test.ts'),
  },
  'a run that re-recorded an edited module': {
    previous: at(BASELINE, 'test/alpha.test.ts'),
    current: rewritten(at(LOCAL, 'test/beta.test.ts')),
  },
  'a run that touched one module of three': {
    previous: at(BASELINE, 'test/alpha.test.ts', WIDE),
    current: at(LOCAL, 'test/beta.test.ts', ['src/decide.ts']),
  },
  'a module loaded before its test began, re-recorded': {
    previous: loadedEarly(at(BASELINE, 'test/alpha.test.ts')),
    current: loadedEarly(at(LOCAL, 'test/beta.test.ts')),
  },
  'a module loaded before its test began, carried': {
    previous: loadedEarly(at(BASELINE, 'test/alpha.test.ts', WIDE)),
    current: at(LOCAL, 'test/beta.test.ts', ['src/decide.ts']),
  },
  'a region loaded by some of the tests that crossed it, carried': {
    previous: loadedByOne(BASELINE, WIDE),
    current: at(LOCAL, 'test/gamma.test.ts', ['src/decide.ts']),
  },
  'a region loaded by some of the tests that crossed it, one of them retired': {
    previous: loadedByOne(BASELINE, WIDE),
    current: at(LOCAL, 'test/alpha.test.ts', ['src/decide.ts']),
  },
  'a test retired while something it loaded early is carried': {
    previous: loadedEarly(at(BASELINE, 'test/alpha.test.ts', WIDE)),
    current: at(LOCAL, 'test/alpha.test.ts', ['src/decide.ts']),
  },
  'a run that added a module the index never held': {
    previous: at(BASELINE, 'test/alpha.test.ts', ['src/decide.ts']),
    current: at(LOCAL, 'test/beta.test.ts', ['src/zeta.ts']),
  },
  'a test re-recorded whole, retiring what it used to enter': {
    previous: at(BASELINE, 'test/alpha.test.ts', WIDE),
    current: at(LOCAL, 'test/alpha.test.ts', ['src/decide.ts']),
  },
  'a test re-recorded under changed preconditions': {
    previous: at(BASELINE, 'test/alpha.test.ts', WIDE),
    current: {
      ...at(LOCAL, 'test/alpha.test.ts', ['src/decide.ts'], false),
      tests: [{
        file: 'test/alpha.test.ts',
        complete: false,
        preconditions: [{ name: 'test/alpha.test.ts', digest: 'source:test-moved' }],
      }],
    },
  },
  'a module whose two regions are one address, re-recorded': {
    previous: twins(BASELINE, [
      ['test/alpha.test.ts', 'test/beta.test.ts'],
      ['test/alpha.test.ts'],
      ['test/beta.test.ts'],
    ]),
    current: twins(LOCAL, [['test/gamma.test.ts'], [], []]),
  },
  'a carried test whose regions are gone': {
    previous: at(BASELINE, 'test/alpha.test.ts'),
    current: {
      ...at(LOCAL, 'test/beta.test.ts'),
      modules: [{
        file: 'src/decide.ts',
        sourceDigest: 'source:src/decide.ts',
        instrumented: true,
        blocks: [],
      }],
    },
  },
  'a carried module whose text moved': {
    previous: at(BASELINE, 'test/alpha.test.ts'),
    current: { ...at(LOCAL, 'test/beta.test.ts'), modules: [] },
    onDisk: new Map([['src/decide.ts', `const scale = 2;\n\n${DECIDE}`]]),
  },
  'a carried module whose text moved and holds a retired crossing': {
    previous: at(BASELINE, 'test/alpha.test.ts'),
    current: { ...at(LOCAL, 'test/alpha.test.ts'), modules: [] },
    onDisk: new Map([['src/decide.ts', `const scale = 2;\n\n${DECIDE}`]]),
  },
  'a carried module whose text lost the region a test entered': {
    previous: at(BASELINE, 'test/alpha.test.ts'),
    current: { ...at(LOCAL, 'test/beta.test.ts'), modules: [] },
    onDisk: new Map([['src/decide.ts', 'const scale = 2;\n']]),
  },
  'a carried module whose text cannot be read as source': {
    previous: at(BASELINE, 'test/alpha.test.ts'),
    current: { ...at(LOCAL, 'test/beta.test.ts'), modules: [] },
    onDisk: new Map([['src/decide.ts', 'export function decide( {']]),
  },
  'a carried module the run never loaded': {
    previous: at(BASELINE, 'test/alpha.test.ts', WIDE),
    current: { ...at(LOCAL, 'test/beta.test.ts'), modules: [] },
  },
  'a run recorded outside a checkout': {
    previous: at(BASELINE, 'test/alpha.test.ts', WIDE),
    current: at(undefined, 'test/beta.test.ts'),
  },
  'a path read by two builds, one of them re-recorded': {
    previous: twoBuilds(BASELINE, 'test/chromium.test.ts', 'test/webkit.test.ts'),
    current: at(LOCAL, 'test/chromium.test.ts'),
  },
  'a path read by two builds, both of them re-recorded': {
    previous: twoBuilds(BASELINE, 'test/chromium.test.ts', 'test/webkit.test.ts'),
    current: twoBuilds(LOCAL, 'test/chromium.test.ts', 'test/webkit.test.ts'),
  },
  'a module recorded as one this build never measured': {
    previous: {
      ...at(BASELINE, 'test/alpha.test.ts', WIDE),
      modules: at(BASELINE, 'test/alpha.test.ts', WIDE).modules.map((module, index) =>
        index === 0 ? { ...module, instrumented: false, blocks: [] } : module),
    },
    current: { ...at(LOCAL, 'test/beta.test.ts'), modules: [] },
    onDisk: new Map([['src/alpha.ts', DECIDE]]),
  },
};

describe('layerTestCoverage', () => {
  for (const [what, { previous, current, onDisk }] of Object.entries(CASES)) {
    it(`writes the same file as decode, merge and encode: ${what}`, () => {
      const bytes = previous === undefined ? undefined : encodeTestCoverage(previous);
      const expected = encodeTestCoverage(mergeCoverage(previous, current, onDisk));

      expect(layerTestCoverage(bytes, current, onDisk).equals(expected)).toBe(true);
    });
  }

  it('treats a file it cannot decode as one that is not there', () => {
    const current = at(LOCAL, 'test/beta.test.ts');

    expect(layerTestCoverage(Buffer.from('not a snapshot'), current).equals(
      encodeTestCoverage(current),
    )).toBe(true);
  });

  it('carries strings no comparison of bytes could order', () => {
    // UTF-8 byte order and UTF-16 code unit order part company above U+E000,
    // and the dictionary is sorted by the second. A module named past that line
    // is what sends the merge back to comparing strings, so one is written here
    // rather than assumed never to exist.
    const previous = at(BASELINE, 'test/alpha.test.ts', ['src/\u{1f600}.ts', 'src/.ts']);
    const current = at(LOCAL, 'test/beta.test.ts', ['src/decide.ts']);

    expect(layerTestCoverage(encodeTestCoverage(previous), current).equals(
      encodeTestCoverage(mergeCoverage(previous, current)),
    )).toBe(true);
  });
});
