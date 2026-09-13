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
