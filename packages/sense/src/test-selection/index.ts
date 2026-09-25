import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { FileRecord } from '@variance-authority/core/relate';
import type { BlockKind } from '../instrument/index.js';
import { layeredFiles, repositoryLayers } from './cache-layers.js';
import { deviationFromView } from './deviation.js';
import {
  journeyDivergences,
  type JourneyDivergence,
  type JourneyDivergenceOptions,
  type JourneyRegion,
} from './divergence.js';
import { decodeTestCoverage, encodeTestCoverage } from './format.js';
import { openTestCoverage } from './format-view.js';
import { askCoverageFile } from './coverage-file.js';
import type {
  SourceAudience,
  SourceAudienceTest,
  SourcePoint,
  SourceRegion,
} from './at-source.js';
import { foldTestCoverage, mergeCoverage, type CoverageShard } from './merge.js';
import { distanceFromView, type DistanceOptions, type TestDistance } from './distance.js';
import {
  narrowByExecutionFromView,
  selectTestFilesFromView,
  type ExecutionNarrowing,
  type ExecutionNarrowingOptions,
  type ImporterReason,
  type SelectionCause,
  type SelectionReason,
} from './select.js';

export {
  coveringChange,
  coveringTests,
  coveringTestsInFile,
  ranWhileLoading,
  stoppedBefore,
  type CoveringChange,
  type CoveringChangeOptions,
  type CoveringOptions,
  type CoveringRegion,
  type CoveringTest,
  type ExecutionBlock,
  type ExecutionCrossing,
  type ExecutionIndex,
  type ExecutionModule,
  type ExecutionTest,
  type SourceTestTarget,
  type SourceTestRange,
} from './reverse.js';
export { anyStopped } from './stopped.js';
export { placeInText, type HeldLines, type Placement } from './placed.js';
export { stateOf, type RangeState } from './range-state.js';
export { narrowByJourneys, type JourneySelectionOptions } from './execution-select.js';
export { projectJourneyFile, selectJourneyFile, type JourneyProjection } from './journey-native.js';
export { formatCoveringChange, type CoveringChangeHeading } from './covering-change-text.js';
export {
  EXECUTION_FORMAT,
  decodeExecutionIndex,
  encodeExecutionIndex,
  executionIndexBytes,
  isEncodedExecutionIndex,
} from './execution-format.js';
export { mergeExecutionIndexes } from './execution-merge.js';
export { finalizeJestJourneys, pendingJourneyDirectory, stitchJourneyArtifacts, type JourneyArtifactResult } from './jest-journey-artifact.js';
export type { BlockKind, ExecutionNarrowing, ExecutionNarrowingOptions, ImporterReason, SelectionCause, SelectionReason };
export { readingLines, type FileReading } from './reading-lines.js';
export { journeyDivergences };
export {
  atDistance,
  distanceRange,
  groupByDistance,
  remaining,
  type DistanceGroup,
} from './at-distance.js';
export { distanceFromView, nearestFirst } from './distance.js';
export { testsReaching, testsReachingFromView, distanceToSource } from './at-source.js';
export type { SourceAudience, SourceAudienceTest, SourcePoint, SourceRegion };
// The file list a selection will ask about, so a caller wiring `sourceAt` names
// exactly the paths the selector will name and not a second parse of the same
// diff that disagrees with this one at the edges — a rename, a mode change, a
// binary file.
export { changedLines, type LineRange } from './diff-lines.js';
// The other half of that wiring, for the ordinary case of a git checkout. It
// ships because the check is opt-in: a caller that does not know to pass
// `sourceAt` gets `stale` empty, which reads exactly like frames that agree.
export { textAtRecording } from './recorded-text.js';
export type {
  Bearing,
  DistanceOptions,
  Face,
  Faces,
  ReachThrough,
  TestDistance,
} from './distance.js';
export { eitherFace, indexFaces } from './faces.js';
export type { JourneyDivergence, JourneyDivergenceOptions, JourneyRegion };
export { foldTestCoverage, mergeCoverage };
export {
  CACHE_CONFIG,
  cacheLayers,
  cacheRootFor,
  layeredFiles,
  repositoryLayers,
  type CacheLayers,
} from './cache-layers.js';
export { repositoryRoot } from './repository-root.js';
// The write path's counterpart to `mergeCoverage`: the same fold, over the
// columns of the file it is about to write over rather than over a model
// somebody decoded first.
export { layerTestCoverage, layeredCoverage } from './format-layer.js';
// A snapshot read where it lies, for a caller asking several questions of one
// file and not wanting the seventy megabytes the answers do not touch. The
// file-taking queries below are this plus a `finally`.
export { askCoverageFile, openCoverageFile, type CoverageFile } from './coverage-file.js';
// Where the run that wrote the case index last is named, and what it replaced.
export { caseLayerFiles, type LastCaseRun } from './case-fold.js';
export { caseMotion, type CaseMotion, type CaseMotionOptions, type MovedRegion } from './case-motion.js';
export type { RegionMotion, RegionMotionKind, TestFileMotion } from './case-motion.js';
export type { CoverageShard };

/**
 * The lines of the source a region was written on, inclusive — or neither.
 *
 * A transform is free to write text nobody wrote: esbuild lowers a decorator by
 * prepending the helpers it calls, and the map it hands back gives them no
 * origin. Their regions are real — the build runs them and the probes count
 * them — but they are nowhere in the file a diff is written against. Absent is
 * the honest record: a line would be a place the region was never written,
 * and the narrowest phantom there decides what an edit to it selects.
 */
export type WrittenLines =
  | { readonly startLine: number; readonly endLine: number }
  | { readonly startLine?: never; readonly endLine?: never };

export type CoverageBlock = CoverageRegion & WrittenLines;

interface CoverageRegion {
  readonly ordinal: number;
  readonly kind: BlockKind;
  /** Ordinal of the enclosing arrival region; absent only on the module root. */
  readonly owner?: number;
  /** Identity of this region's source after child-region bodies are excluded. */
  readonly digest: string;
  readonly name: string;
  readonly path: string;
  /** False for a synthesized control-flow region with no source of its own. */
  readonly source: boolean;
  readonly testFiles: readonly string[];
  /**
   * The test files this region had already been entered for before their first
   * test ran: a consequence of loading the module, not of anything a test did.
   * A function here is a side effect of import, and a suite whose order can
   * change is a suite that will see it at different times. Absent when no file
   * had: every producer records the fact, so an empty list and no list say the
   * same thing.
   */
  readonly loadedBy?: readonly string[];
}

export interface CoverageModule {
  readonly file: string;
  /**
   * Digest of the module's text as it is on disk: the text whose lines the
   * blocks are coordinates in, and what a later run compares against to know
   * whether those coordinates still hold.
   */
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
  /**
   * Absent when the test, or a file its closure imports, is missing from Sense.
   * A file whose imports could not all be read counts with the edges it has.
   */
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

/**
 * Where this checkout keeps its snapshot.
 *
 * The checkout's own directory, which in the primary checkout is the
 * repository's and in a worktree is a layer above it — see {@link repositoryLayers}.
 * It is the write target either way: nothing writes to a layer it does not own.
 *
 * A worktree's is empty until {@link seedTestCoverage} fills it.
 */
export function testCoverageFile(root: string, cacheRoot?: string): string {
  return resolve(repositoryLayers(root, cacheRoot).top, 'coverage.bin');
}

/**
 * Give a checkout the repository's snapshot to build its own on top of.
 *
 * A worktree cut this morning is a checkout of a repository that has been
 * recording for months, and with a cache directory of its own it would inherit
 * none of that: the first run in it re-instruments a world already sitting on
 * disk a directory away. So before the first run, the base is copied up — once,
 * and only when this checkout has nothing of its own, because after that the
 * checkout's own snapshot is the base plus everything its branch has recorded,
 * and the base is the staler of the two.
 *
 * A copy rather than a read-through join, because the write path already layers:
 * `layeredCoverage` folds a run into a whole snapshot, so a worktree that starts
 * from a copy of the base and lands its runs on that copy holds exactly what a
 * two-layer read would have computed, without paying for the join on every read
 * or pinning the base while it works.
 *
 * A base this build cannot read is not copied and not an error. That is the same
 * answer {@link recordedCommit} gives, for the same reason: a snapshot written
 * by another layout is a snapshot this run has no claim on, and one stale base
 * must not be able to fail every worktree of the repository at once. The run
 * proceeds with no index and records one.
 *
 * Does nothing at all when the caller named its own file, or in the primary
 * checkout, where the two layers are one directory.
 */
export async function seedTestCoverage(
  file: string,
  root: string,
  cacheRoot?: string,
): Promise<void> {
  const layers = repositoryLayers(root, cacheRoot);
  // A caller that named its own file owns it, and it is not a layer of
  // anything: there is no base beneath a path somebody passed in.
  if (layers.top === layers.base || file !== resolve(layers.top, 'coverage.bin')) return;
  try {
    await stat(file);
    return;
  } catch (error) {
    if (!missing(error)) throw error;
  }
  try {
    const bytes = await readFile(resolve(layers.base, 'coverage.bin'));
    // Opening parses the section index and nothing else, which is the whole of
    // what "this build can read it" means and costs a fraction of a decode.
    openTestCoverage(bytes);
    await writeCoverageBytes(file, bytes);
  } catch {
    // No base, or one this build has no claim on. Either way there is nothing
    // to inherit and the run records its own.
  }
}

/**
 * The nearest snapshot a checkout can read, without writing anything.
 *
 * A reader asks what is known, and in a worktree that has not run yet what is
 * known is the repository's. Reading is not first use — a question about the
 * index should not cost the asker a copy of it — so this resolves rather than
 * seeds, and the copy happens when a run lands, which is the moment the
 * checkout acquires something of its own to keep.
 *
 * The path is returned even when neither layer holds a file, so a caller that
 * wants to say which file it could not read has one to name.
 */
export async function readableTestCoverage(
  root: string,
  cacheRoot?: string,
): Promise<string> {
  const files = layeredFiles(repositoryLayers(root, cacheRoot), 'coverage.bin');
  for (const file of files) {
    try {
      await stat(file);
      return file;
    } catch (error) {
      if (!missing(error)) throw error;
    }
  }

  return files[0]!;
}

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
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
 * It is the counterpart to {@link writeTestCoverage}; `mergeCoverage` and
 * `foldTestCoverage` take and return this same shape between the two.
 */
export async function readTestCoverage(file: string): Promise<TestCoverage> {
  return decodeTestCoverage(await readFile(file));
}

/**
 * Write one snapshot where readers will find it, whole or not at all.
 *
 * The counterpart to {@link readTestCoverage}, and the only writer: every seam
 * that records — the Vitest reporter, a journal transport draining a driven
 * page, a job folding shards — lands its result through here. It is a rename
 * over a temporary file in the same directory, so a reader that opens the path
 * sees the previous snapshot or this one and never the bytes between; a
 * selector reading a half-written file would not fail, it would narrow on a
 * truncated record, and that is the one outcome a writer of this file must make
 * impossible.
 *
 * It does not merge. A caller landing a run over what was already recorded
 * reads the existing file, folds with {@link mergeCoverage}, and writes the
 * result; a caller installing a baseline fetched from elsewhere writes it as it
 * came. Which of those is wanted is the caller's knowledge, and a writer that
 * merged on its own would make the second one impossible.
 */
export async function writeTestCoverage(file: string, coverage: TestCoverage): Promise<void> {
  await writeCoverageBytes(file, encodeTestCoverage(coverage));
}

/**
 * The same write, for a caller that already holds the bytes.
 *
 * Which is what `layeredCoverage` hands back: it merges and encodes in one pass
 * over the columns, so there is no model at the end of it to hand a writer that
 * insists on one.
 */
export async function writeCoverageBytes(file: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}-${randomUUID()}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, file);
}

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

/**
 * Where a snapshot was recorded, without decoding it.
 *
 * The one field a caller asking "what has changed since the index was written"
 * needs, and the whole of what it needs. Reading it through
 * {@link readTestCoverage} builds every module and region in the file to reach
 * forty hex characters at the head of it — most of a second at a repository's
 * scale, on a command an operator is waiting at a prompt for. Opening parses the
 * section index and the one string.
 *
 * `undefined` for an index recorded outside a checkout, which has no position,
 * and for a file this build cannot read — the caller's next move is the same
 * either way, and it is not to explain a format to somebody asking about a diff.
 */
export async function recordedCommit(file: string): Promise<string | undefined> {
  try {
    return askCoverageFile(file, (coverage) => coverage.commit);
  } catch {
    return undefined;
  }
}

/** Compare per-test execution slices with the static code each test can reach. */
export async function deviationOfTests(
  file: string,
  options: DeviationOptions,
): Promise<VariationDeviation> {
  return askCoverageFile(file, (coverage) => deviationFromView(coverage, options));
}
