/**
 * What a landing reads of the record `combineRecords` wrote, and the coverage
 * it lands, off the record's columns.
 *
 * The record holds the whole suite. Decoded into a model, a record of two
 * hundred thousand modules is gigabytes of objects, and a landing over nothing
 * reads none of them: the record already is the coverage it lands. What the
 * runs record and the case landing ask of it — the test files, the text each
 * module was cut from, the commit — is a few columns.
 */

import { decodeTestCoverage } from './format.js';
import { layerTestCoverage } from './format-layer.js';
import type { TestCoverageView } from './format-view.js';
import type { LaidRun } from './case-landing.js';
import type { TestCoverage } from './index.js';

/** A record's run, as the runs record and the case landing read it. */
export interface RecordedRun extends LaidRun {
  readonly instrumentation: TestCoverage['instrumentation'];
  readonly tests: readonly { readonly file: string; readonly complete: boolean }[];
  readonly modules: readonly { readonly file: string; readonly sourceDigest: string }[];
}

/** The run `coverage` records: its test files, the text of each of its modules, its commit. */
export function recordedRun(coverage: TestCoverageView): RecordedRun {
  const testPath = coverage.testPath.all();
  const complete = coverage.testComplete.all();
  const modulePath = coverage.modulePath.all();
  const source = coverage.moduleSource.all();
  return {
    instrumentation: coverage.instrumentation,
    ...(coverage.commit === undefined ? {} : { commit: coverage.commit }),
    tests: Array.from(testPath, (path, test) => ({ file: coverage.string(path), complete: complete[test] === 1 })),
    modules: Array.from(modulePath, (path, module) => ({ file: coverage.string(path), sourceDigest: coverage.string(source[module]!) })),
  };
}

/**
 * The coverage `fold` lands as over `previous`, the record already at the
 * target, as `mergeCoverage` lays it: `fold` itself over nothing, or over a
 * record under other probes, which it replaces.
 *
 * Both are records this build opens; the caller has refused one it cannot.
 */
export function landedCoverage(
  previous: { readonly bytes: Uint8Array; readonly coverage: TestCoverageView } | undefined,
  fold: { readonly bytes: Uint8Array; readonly coverage: TestCoverageView },
): Uint8Array {
  if (previous === undefined || previous.coverage.instrumentation !== fold.coverage.instrumentation) return fold.bytes;
  // FIXME: over a record, the fold is decoded into the model the runner's own
  // layering lays, and at two hundred thousand modules that model is gigabytes:
  // a landing of the whole suite over a record of it does not fit where the
  // landing over nothing does. Laying a record over a record without the model
  // is the layering's own rule moved into the addon, for every runner at once.
  return layerTestCoverage(previous.bytes, decodeTestCoverage(fold.bytes));
}
