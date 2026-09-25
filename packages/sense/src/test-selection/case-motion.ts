// compass: variance-authority/runtime/attention
import type { Relations } from '@variance-authority/core/relate';
import { addressKey } from './merge-carry.js';
import type { ExecutionBlock, ExecutionIndex, ExecutionModule, ExecutionTest } from './reverse.js';
import { stoppedIn } from './stopped.js';

/**
 * What a region's cases did between two records.
 *
 * - `lost`: cases called into it at the base, none do now, and every case that
 *   could have reached it finished.
 * - `hidden`: as `lost`, but a case that could have reached it stopped, so the
 *   region may be walked by a test that no longer gets there.
 * - `thinned`: several cases called into it at the base, one does now.
 * - `gained`: no case called into it at the base, one or more do now.
 */
export type RegionMotionKind = 'lost' | 'hidden' | 'thinned' | 'gained';

/** A region as the current record places it. */
export interface MovedRegion {
  readonly file: string;
  readonly kind: string;
  readonly name: string;
  readonly startLine: number;
  readonly endLine: number;
}

/** One region whose cases moved, with the cases at each end. */
export interface RegionMotion extends MovedRegion {
  readonly motion: RegionMotionKind;
  /** The cases that called into it at the base, as the base records them. */
  readonly before: readonly ExecutionTest[];
  /** The cases that call into it now. */
  readonly now: readonly ExecutionTest[];
  /**
   * On `hidden`: the stopped cases that could have reached it. Absent when the
   * record cannot say which could have, which is not the same as none.
   */
  readonly stopped?: readonly ExecutionTest[];
}

/** One test file's reach, read against the base: regions it enters now and did not, and the reverse. */
export interface TestFileMotion {
  readonly file: string;
  readonly entered: readonly MovedRegion[];
  readonly left: readonly MovedRegion[];
}

/** What moved between two records: the regions, their counts, and each test file's reach. */
export interface CaseMotion {
  /** Every region that moved, by file and then line. */
  readonly regions: readonly RegionMotion[];
  readonly counts: Readonly<Record<RegionMotionKind, number>>;
  /** Every test file whose reach moved, by file. */
  readonly testFiles: readonly TestFileMotion[];
  /**
   * Modules the base holds and the current record has no row for. Nothing is
   * said about their regions: no row is not the same as no case.
   */
  readonly unread: readonly string[];
}

/** What `caseMotion` may consult, and what it leaves out. */
export interface CaseMotionOptions {
  /** The file graph, which names the stopped cases that could have reached a region. */
  readonly relations?: Relations;
  /** Modules left out of the comparison, such as the ones the base's branch changed since the fork. */
  readonly exclude?: ReadonlySet<string>;
}

/**
 * The regions whose cases moved between `base` and `now`.
 *
 * A region is matched by address — name path and structural path, told apart
 * by occurrence — and kind, the rule the case index carries its cases by
 * across runs, so a region an edit moved down the file is still the same
 * region. A region only one side holds did not move: the edit wrote or deleted
 * it, and the diff already says so. Only calls count; a region entered while
 * its module evaluated was entered by whichever case imported it first.
 */
export function caseMotion(base: ExecutionIndex, now: ExecutionIndex, options: CaseMotionOptions = {}): CaseMotion {
  const regions: RegionMotion[] = [];
  const reach = new Map<string, { entered: MovedRegion[]; left: MovedRegion[] }>();
  const reachOf = (file: string) => {
    let held = reach.get(file);
    if (held === undefined) reach.set(file, (held = { entered: [], left: [] }));
    return held;
  };
  const current = new Map(now.modules.map((module) => [module.file, module]));
  const unread: string[] = [];
  for (const held of base.modules) {
    if (options.exclude?.has(held.file) === true) continue;
    const module = current.get(held.file);
    if (module === undefined) {
      unread.push(held.file);
      continue;
    }
    let stopped: ReadonlySet<number> | undefined | null = null;
    for (const [row, block] of matched(held, module)) {
      const region = { file: module.file, kind: block.kind, name: block.name, startLine: block.startLine, endLine: block.endLine };
      const before = callers(base, row);
      const after = callers(now, block);
      const was = filesOf(before);
      const is = filesOf(after);
      for (const file of is) if (!was.has(file)) reachOf(file).entered.push(region);
      for (const file of was) if (!is.has(file)) reachOf(file).left.push(region);
      const moved = { ...region, before, now: after };
      if (before.length > 0 && after.length === 0) {
        if (stopped === null) stopped = stoppedIn(now, module, options.relations);
        const cases = stopped === undefined ? undefined : [...stopped].sort((left, right) => left - right);
        if (cases?.length === 0) regions.push({ ...moved, motion: 'lost' });
        else regions.push({ ...moved, motion: 'hidden', ...(cases === undefined ? {} : { stopped: cases.map((at) => now.tests[at]!) }) });
      } else if (before.length > 1 && after.length === 1) regions.push({ ...moved, motion: 'thinned' });
      else if (before.length === 0 && after.length > 0) regions.push({ ...moved, motion: 'gained' });
    }
  }
  regions.sort((left, right) => (left.file < right.file ? -1 : left.file > right.file ? 1 : left.startLine - right.startLine));
  const counts = { lost: 0, hidden: 0, thinned: 0, gained: 0 };
  for (const region of regions) counts[region.motion] += 1;
  const testFiles = [...reach]
    .map(([file, { entered, left }]) => ({ file, entered: inOrder(entered), left: inOrder(left) }))
    .sort((left, right) => (left.file < right.file ? -1 : left.file > right.file ? 1 : 0));
  return { regions, counts, testFiles, unread: unread.sort() };
}

/** The source regions both records hold, each with its row at the base. */
function matched(base: ExecutionModule, now: ExecutionModule): readonly (readonly [ExecutionBlock, ExecutionBlock])[] {
  const held = new Map<string, ExecutionBlock>();
  const seen = new Map<string, number>();
  for (const block of base.blocks) held.set(addressKey(`${block.name}\0${block.path}`, seen), block);
  seen.clear();
  const pairs: (readonly [ExecutionBlock, ExecutionBlock])[] = [];
  for (const block of now.blocks) {
    const was = held.get(addressKey(`${block.name}\0${block.path}`, seen));
    if (was !== undefined && was.kind === block.kind && block.source) pairs.push([was, block]);
  }
  return pairs;
}

/** The cases that called into a region, once each, in record order. */
function callers(index: ExecutionIndex, block: ExecutionBlock): readonly ExecutionTest[] {
  const at = new Set<number>();
  for (const crossing of block.crossings) if (crossing.loaded !== true) at.add(crossing.test);
  return [...at].sort((left, right) => left - right).map((test) => index.tests[test]!);
}

function filesOf(tests: readonly ExecutionTest[]): ReadonlySet<string> {
  return new Set(tests.map((test) => test.file));
}

function inOrder(regions: readonly MovedRegion[]): readonly MovedRegion[] {
  return [...regions].sort((left, right) =>
    left.file < right.file ? -1 : left.file > right.file ? 1 : left.startLine - right.startLine,
  );
}
