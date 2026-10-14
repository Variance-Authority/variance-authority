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

import { native, nativeRefusal } from '../addon.js';
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

/** A record where it lies, and its coverage. */
export interface LyingRecord {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly coverage: TestCoverageView;
}

/**
 * The coverage `fold` lands as over `previous`, the record already at the
 * target, as a runner's teardown lays its run over the record it found:
 * `fold` itself over nothing, or over a record under other probes, which it
 * replaces. The addon lays one over the other column to column; neither is
 * decoded.
 *
 * Both are records this build opens; a `previous` the lay cannot read throws,
 * and the caller refuses it.
 */
export function landedCoverage(previous: LyingRecord | undefined, fold: LyingRecord): Uint8Array {
  if (previous === undefined || previous.coverage.instrumentation !== fold.coverage.instrumentation) return fold.bytes;
  const lay = native()?.layRecords;
  if (lay === undefined) {
    throw new Error(`landing over a record requires the Sense native addon: ${nativeRefusal() ?? 'the loaded addon has no `layRecords`'}`);
  }
  const bytes = (record: Uint8Array): Buffer => Buffer.from(record.buffer, record.byteOffset, record.byteLength);
  return lay(bytes(previous.bytes), bytes(fold.bytes)) ?? fold.bytes;
}
