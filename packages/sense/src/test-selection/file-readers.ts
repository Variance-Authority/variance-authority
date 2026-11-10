// compass: variance-authority.reach
/**
 * The questions a caller asks of a snapshot on disk, each read where it lies.
 *
 * Every one opens the file through {@link askCoverageFile} and hands the view to
 * the query that owns the answer, so none of them decodes more than it asked.
 */
import { askCoverageFile } from './coverage-file.js';
import { deviationFromView } from './deviation.js';
import { distanceFromView, type DistanceOptions, type TestDistance } from './distance.js';
import { narrowByExecutionFromView, selectTestFilesFromView } from './select.js';
import type { DeviationOptions, VariationDeviation } from './index.js';
import type { ExecutionNarrowing, ExecutionNarrowingOptions } from './narrowing.js';

/**
 * Query one persisted coverage snapshot and return whole test-file paths.
 * Only the section index and strings present in the result are decoded.
 *
 * Hand the file graph in through `options.relations` and a changed file no
 * probe can sit in — a stylesheet, an image — is answered by the module that
 * imports it; without it, such a file selects nothing, and only
 * `narrowByExecution` says so.
 */
export async function selectTestFiles(
  file: string,
  diff: string,
  options: ExecutionNarrowingOptions = {},
): Promise<readonly string[]> {
  return askCoverageFile(file, (coverage) => selectTestFilesFromView(coverage, diff, options));
}

/**
 * The same query, plus the tests the snapshot is entitled to speak for, what it
 * could not answer, and why each selected test is there.
 *
 * Read this rather than `selectTestFiles` whenever the answer will *exclude*
 * something. See `ExecutionNarrowing`.
 */
export async function narrowByExecution(
  file: string,
  diff: string,
  options: ExecutionNarrowingOptions = {},
): Promise<ExecutionNarrowing> {
  return askCoverageFile(file, (coverage) => narrowByExecutionFromView(coverage, diff, options));
}

/**
 * The same query, and how far the change had to travel to reach each test it
 * selected.
 *
 * One read, because the two answers come off the same columns and a caller that
 * asked twice would decode the snapshot twice to join a reading to the narrowing
 * it was derived from.
 */
export async function distanceByExecution(
  file: string,
  diff: string,
  options: ExecutionNarrowingOptions & DistanceOptions = {},
): Promise<{ readonly narrowing: ExecutionNarrowing; readonly distances: readonly TestDistance[] }> {
  return askCoverageFile(file, (coverage) => {
    const narrowing = narrowByExecutionFromView(coverage, diff, options);
    return { narrowing, distances: distanceFromView(coverage, narrowing, options) };
  });
}

/** Compare per-test execution slices with the static code each test can reach. */
export async function deviationOfTests(
  file: string,
  options: DeviationOptions,
): Promise<VariationDeviation> {
  return askCoverageFile(file, (coverage) => deviationFromView(coverage, options));
}
