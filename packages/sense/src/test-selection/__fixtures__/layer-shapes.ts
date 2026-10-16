/**
 * The shapes a run is laid over a record in: a snapshot of a few modules at a
 * commit, and the same snapshot edited, rebuilt, timed, loaded before its test
 * began, read by two builds, or holding two regions at one address. The cases
 * `format-layer.test.ts` lays are built from these (`layer-cases.ts`).
 */

import { editKey, type EditReading } from '../edit-readings.js';
import type { CoverageBlock, TestCoverage } from '../index.js';


export const BASELINE = '1111111111111111111111111111111111111111';
export const LOCAL = '2222222222222222222222222222222222222222';
export const DECIDE = 'export function decide(n) {\n  return n > 0;\n}\n';

export function root(digest: string, testFiles: readonly string[]): CoverageBlock {
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

export function entry(digest: string, testFiles: readonly string[]): CoverageBlock {
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
export function at(
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
export function rewritten(coverage: TestCoverage): TestCoverage {
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
 * The same snapshot cut by another build of the same text: the source digest
 * stands and every region's digest, taken of the emitted text, moved.
 */
export function rebuilt(coverage: TestCoverage): TestCoverage {
  return {
    ...coverage,
    modules: coverage.modules.map((module) => ({
      ...module,
      blocks: module.blocks.map((block) => ({ ...block, digest: `${block.digest}-dist` })),
    })),
  };
}

/**
 * The same snapshot with the module's own region marked as entered before the
 * test began: the second crossing list, which rides on every row beside the
 * first and has to be carried, retired and re-cut exactly as the first is.
 */
export function loadedEarly(coverage: TestCoverage): TestCoverage {
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
export function loadedByOne(commit: string | undefined, files: readonly string[]): TestCoverage {
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
export function twoBuilds(commit: string | undefined, first: string, second: string): TestCoverage {
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
export function twins(
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

export const WIDE = ['src/alpha.ts', 'src/decide.ts', 'src/zeta.ts'];

/** The same snapshot with every test timed by its runner at `duration` milliseconds. */
export function timed(coverage: TestCoverage, duration: number): TestCoverage {
  return { ...coverage, tests: coverage.tests.map((test) => ({ ...test, duration })) };
}

export interface Case {
  readonly previous: TestCoverage | undefined;
  readonly current: TestCoverage;
  readonly onDisk?: ReadonlyMap<string, string>;
  readonly readings?: ReadonlyMap<string, EditReading>;
  /** The record the lay writes, as `printed` lists it. */
  readonly laid: readonly string[];
}

/** The same snapshot with its test loading each module and entering nothing in it. */
export function loadedOnly(coverage: TestCoverage): TestCoverage {
  return {
    ...coverage,
    modules: coverage.modules.map((module) => ({
      ...module,
      blocks: module.blocks.map((block) => (block.kind === 'module' ? block : { ...block, testFiles: [] })),
    })),
  };
}

/** The selector's reading of the edit {@link rewritten} makes to `src/decide.ts`. */
export function read(reading: EditReading): ReadonlyMap<string, EditReading> {
  return new Map([[editKey('src/decide.ts', 'source:src/decide.ts', 'source:src/decide.ts-edited'), reading]]);
}

