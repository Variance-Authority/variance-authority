import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { digestString, type FileRecord } from '@variance-authority/core';
import type { BlockKind } from '../instrument/index.js';
import { deviationFromView } from './deviation.js';
import {
  journeyDivergences,
  type JourneyDivergence,
  type JourneyDivergenceOptions,
  type JourneyRegion,
} from './divergence.js';
import { decodeTestCoverage, openTestCoverage } from './format.js';
import {
  narrowByExecutionFromView,
  selectTestFilesFromView,
  type ExecutionNarrowing,
} from './select.js';

export {
  coveringTests,
  coveringTestsInFile,
  type CoveringTest,
  type ExecutionBlock,
  type ExecutionCrossing,
  type ExecutionIndex,
  type ExecutionModule,
  type ExecutionTest,
  type SourceTestTarget,
  type SourceTestRange,
} from './reverse.js';
export type { BlockKind };
export type { ExecutionNarrowing };
export { journeyDivergences };
export type { JourneyDivergence, JourneyDivergenceOptions, JourneyRegion };

export interface CoverageBlock {
  readonly ordinal: number;
  readonly kind: BlockKind;
  /** Ordinal of the enclosing arrival region; absent only on the module root. */
  readonly owner?: number;
  /** Identity of this region's source after child-region bodies are excluded. */
  readonly digest: string;
  readonly name: string;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  /** False for a synthesized control-flow region with no source of its own. */
  readonly source: boolean;
  readonly testFiles: readonly string[];
}

export interface CoverageModule {
  readonly file: string;
  /** Identity of the exact source string whose blocks were instrumented. */
  readonly sourceDigest: string;
  /** False records module-level unknown evidence; consumers widen without consulting its blocks. */
  readonly instrumented: boolean;
  readonly blocks: readonly CoverageBlock[];
}

/** One named input whose identity is a precondition of a test observation. */
export interface CoveragePrecondition {
  /** A repository path or caller-owned domain name. */
  readonly name: string;
  readonly digest: string;
}

/** What one whole test-file observation can honestly claim. */
export interface CoverageTest {
  readonly file: string;
  /** False means this generation is an upper-bound contribution and cannot justify exclusion. */
  readonly complete: boolean;
  /** Test source, mocks, hooks, setup, configuration, and supplied knowledge. */
  readonly preconditions: readonly CoveragePrecondition[];
}

/**
 * The execution journal as a whole: every test the recording held, every module
 * it instrumented, and for each region of a module the tests that entered it.
 *
 * One presence bit per region and test is the entire record; what a run reads
 * off it — where two subjects parted, which subjects a diff reaches, the places
 * each subject entered — is derived from these lists and never written back.
 */
export interface TestCoverage {
  readonly version: 3;
  /** Probe recipe that produced every block and crossing in this snapshot. */
  readonly instrumentation: string;
  /**
   * The commit this snapshot was recorded at — its position in time and space,
   * and the ref a caller diffs against to learn what has changed since.
   *
   * Absent when the recording happened outside a checkout. An index that cannot
   * say where it is cannot be diffed against, so a caller holding one has no
   * grounds to narrow anything and runs the suite it would have run anyway.
   */
  readonly commit?: string;
  readonly tests: readonly CoverageTest[];
  readonly modules: readonly CoverageModule[];
}

export interface CodeExtent {
  readonly files: number;
  readonly loc: number;
}

export interface TestDeviation {
  readonly testFile: string;
  /** Absent when the test is missing from Sense or its closure contains an opaque file. */
  readonly baseline?: CodeExtent;
  readonly slice: CodeExtent;
  readonly sensitivity?: number;
  readonly deviation?: number;
  readonly unknown?: readonly string[];
}

export interface VariationDeviation {
  /** Union of every test baseline. Absent if any baseline is indeterminate. */
  readonly baseline?: CodeExtent;
  /** Union of source lines entered by at least one test file. */
  readonly coverage: CodeExtent;
  readonly coverageRatio?: number;
  /** Arithmetic mean of per-test sensitivity. */
  readonly sensitivity?: number;
  readonly tests: readonly TestDeviation[];
}

export interface DeviationOptions {
  readonly root: string;
  /** Base Sense records including the test files and their product dependencies. */
  readonly records: readonly FileRecord[];
}

/** The repository-keyed cache location shared by the runner and CI selector. */
export function testCoverageFile(
  root: string,
  cacheRoot = process.env['XDG_CACHE_HOME'] ?? resolve(homedir(), '.cache'),
): string {
  const repository = digestString(resolve(root)).replace(/^[^:]+:/, '');
  return resolve(cacheRoot, 'variance-authority', 'test-selection', repository, 'coverage.bin');
}

/**
 * Read one persisted coverage snapshot as the logical model above.
 *
 * The other two readers here answer a question and decode only what the answer
 * needed. This one decodes the whole snapshot, because the caller is asking
 * about the regions themselves — which blocks a module has, which of them a run
 * entered, and which test files entered them — rather than about a selection or
 * a ratio derived from them. That is the only way to ask it: the snapshot is a
 * binary artifact, and a consumer who cannot decode it cannot see the evidence
 * its own runs produced, only the two summaries this module chose to compute.
 *
 * It is the counterpart to `mergeCoverage`, which takes and returns this same
 * shape.
 */
export async function readTestCoverage(file: string): Promise<TestCoverage> {
  return decodeTestCoverage(await readFile(file));
}

/**
 * Query one persisted coverage snapshot and return whole test-file paths.
 * Only the section index and strings present in the result are decoded.
 */
export async function selectTestFiles(file: string, diff: string): Promise<readonly string[]> {
  return selectTestFilesFromView(openTestCoverage(await readFile(file)), diff);
}

/**
 * The same query, plus the tests the snapshot is entitled to speak for.
 *
 * Read this rather than `selectTestFiles` whenever the answer will *exclude*
 * something. See `ExecutionNarrowing`.
 */
export async function narrowByExecution(
  file: string,
  diff: string,
): Promise<ExecutionNarrowing> {
  return narrowByExecutionFromView(openTestCoverage(await readFile(file)), diff);
}

/**
 * Read the snapshot and answer which modules its observers crossed differently.
 *
 * The file reader beside {@link journeyDivergences}, which takes the decoded
 * snapshot. Callers that already hold one — a run that just wrote it — should
 * use that rather than paying for a second decode.
 */
export async function journeysApart(
  file: string,
  options: JourneyDivergenceOptions = {},
): Promise<readonly JourneyDivergence[]> {
  return journeyDivergences(await readTestCoverage(file), options);
}

/** Compare per-test execution slices with the static code each test can reach. */
export async function deviationOfTests(
  file: string,
  options: DeviationOptions,
): Promise<VariationDeviation> {
  return deviationFromView(openTestCoverage(await readFile(file)), options);
}
