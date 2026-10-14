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

import type { TestCoverageView } from './format-view.js';
import type { LaidRun } from './case-landing.js';
import { layRecord } from './format-layer.js';
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
 * target, both as bytes: the one lay a runner's teardown goes through
 * ({@link layRecord}), so `fold` itself over nothing, and a refusal, with the
 * reason, over a record this build cannot read or one under other probes.
 * Neither is decoded.
 */
export function landedCoverage(previous: Uint8Array | undefined, fold: Uint8Array): Uint8Array {
  return previous === undefined ? fold : layRecord(previous, fold);
}
