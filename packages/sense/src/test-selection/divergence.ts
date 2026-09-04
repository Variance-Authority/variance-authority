import type { BlockKind, CoverageModule, TestCoverage } from './index.js';

/**
 * One module, two observers, and not the same path through it.
 *
 * The execution counterpart of `core`'s attribute divergence, and the question
 * that one cannot reach. *The same component rendered two ways from one props
 * digest* states a contradiction and leaves the reader to find it; this names
 * the region. Three stories mount `CartCard`, one of them clicks Remove, and the
 * `onClick` body is a region two of them have never been inside. Nothing static
 * says so — same file, same import graph, same props — and the recording does.
 *
 * ## Why the observers are per module and not per run
 *
 * A subject that never painted a module is not a subject that skipped a region
 * of it, and counting it as one would report every module in the repository as
 * parted by every subject that did not draw it. So the pool is the observers of
 * *that module*, and a module with fewer than two of them has nothing to
 * compare.
 *
 * ## Why an incomplete observation is not evidence of absence
 *
 * The rule `narrowByExecution` states, for the same reason: a run that was cut
 * short entered fewer regions than the subject would have, and its absence from
 * one says nothing about the subject. It is dropped from the pool entirely
 * rather than counted as having missed, which would manufacture a divergence out
 * of a truncated recording.
 */

/** A region of one module, and who has been inside it. */
export interface JourneyRegion {
  /** Never `module`: the root is dropped before a region is built. */
  readonly kind: BlockKind;
  /** What the instrument called it, which is usually the enclosing declaration. */
  readonly name: string;
  readonly startLine: number;
  readonly endLine: number;
  /** Observers of the module that entered it. */
  readonly entered: readonly string[];
  /** Observers of the module that did not. */
  readonly missed: readonly string[];
}

/** What one module's observers did not do alike. */
export interface JourneyDivergence {
  /** Repository-relative path, as the instrument recorded it. */
  readonly file: string;
  /** Everything that entered this module and was observed whole, sorted. */
  readonly observers: readonly string[];
  /** Regions some observers entered and others did not, in source order. */
  readonly parted: readonly JourneyRegion[];
  /**
   * Regions with source of their own that no observer entered.
   *
   * A weaker finding than a parting and a different one: not *these two renders
   * disagree* but *this run never went here at all*, which is the code a visual
   * suite is silent about however many subjects it paints.
   */
  readonly unentered: readonly JourneyRegion[];
}

export interface JourneyDivergenceOptions {
  /**
   * Restrict the pool to these observers.
   *
   * The snapshot accumulates across runs, so without this a subject deleted two
   * commits ago is still a party to every parting it was recorded in. Absent is
   * *every whole observation in the snapshot*, which is the right answer when
   * the caller is reading the record rather than reporting a run.
   */
  readonly observers?: readonly string[];
}

/**
 * Every module whose observers took different paths through it.
 *
 * Modules the instrument did not reach are skipped rather than reported empty:
 * `instrumented: false` records that nothing is known about the module's
 * regions, and a module with no known regions has no unentered ones.
 */
export function journeyDivergences(
  coverage: TestCoverage,
  options: JourneyDivergenceOptions = {},
): readonly JourneyDivergence[] {
  const whole = wholeObservers(coverage, options.observers);
  const found: JourneyDivergence[] = [];

  for (const module of coverage.modules) {
    if (!module.instrumented) continue;
    const divergence = divergenceOf(module, whole);
    if (divergence !== undefined) found.push(divergence);
  }

  return found.sort((left, right) => codeUnitOrder(left.file, right.file));
}

/**
 * The observations entitled to be missing from a region.
 *
 * `complete` is the whole of it. A refused or truncated observation is kept in
 * the snapshot because its crossings are real, and it is dropped here because
 * its *absences* are not.
 */
function wholeObservers(
  coverage: TestCoverage,
  restrict: readonly string[] | undefined,
): ReadonlySet<string> {
  const allowed = restrict === undefined ? undefined : new Set(restrict);
  const whole = new Set<string>();

  for (const test of coverage.tests) {
    if (!test.complete) continue;
    if (allowed !== undefined && !allowed.has(test.file)) continue;
    whole.add(test.file);
  }

  return whole;
}

function divergenceOf(
  module: CoverageModule,
  whole: ReadonlySet<string>,
): JourneyDivergence | undefined {
  // A synthesized region has no source to open, and an implicit `else` nobody
  // took is every `a && b` in the file — a list of them is a list a reader
  // learns to skip past the one entry that meant something. The module root is
  // dropped for a different reason: see `observersOf`.
  const regions = module.blocks.filter((block) => block.source && block.kind !== 'module');
  const observers = observersOf(regions, whole);
  if (observers.size < 2) return undefined;

  const parted: JourneyRegion[] = [];
  const unentered: JourneyRegion[] = [];

  for (const block of regions) {
    const entered = block.testFiles.filter((test) => observers.has(test)).sort(codeUnitOrder);
    if (entered.length === observers.size) continue;

    const missed = [...observers].filter((test) => !entered.includes(test)).sort(codeUnitOrder);
    (entered.length === 0 ? unentered : parted).push({
      kind: block.kind,
      name: block.name,
      startLine: block.startLine,
      endLine: block.endLine,
      entered,
      missed,
    });
  }

  if (parted.length === 0 && unentered.length === 0) return undefined;

  return {
    file: module.file,
    observers: [...observers].sort(codeUnitOrder),
    parted: parted.sort(inSourceOrder),
    unentered: unentered.sort(inSourceOrder),
  };
}

/**
 * Who executed code in this file, which is not who loaded it.
 *
 * The module root is crossed on import, so every subject in a bundle crosses
 * every module in it. Counted as observers, `MainNav`'s two stories would be
 * parties to every region of `CartCard.tsx` they were never near, and the one
 * finding in that file — a click handler two of its three renders have never
 * been inside — would arrive tenth in a list of ten.
 *
 * So the pool is whoever entered a region with source of its own. That is the
 * difference between *this file was in the bundle* and *this file ran*.
 */
function observersOf(
  regions: readonly CoverageModule['blocks'][number][],
  whole: ReadonlySet<string>,
): ReadonlySet<string> {
  const observers = new Set<string>();
  for (const block of regions) {
    for (const test of block.testFiles) if (whole.has(test)) observers.add(test);
  }
  return observers;
}

function inSourceOrder(left: JourneyRegion, right: JourneyRegion): number {
  return left.startLine - right.startLine || left.endLine - right.endLine;
}

/** The order every other list in this package is sorted by. */
function codeUnitOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
