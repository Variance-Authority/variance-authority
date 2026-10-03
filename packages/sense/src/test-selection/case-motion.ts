// compass: variance-authority/runtime/attention
import type { Relations } from '@variance-authority/core/relate';
import { addressKey } from './merge-carry.js';
import { placeThrough, type Hunk } from './placed.js';
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
  /** The cases that called into it at the base, as the base records them, and the retained cases that still do. */
  readonly before: readonly ExecutionTest[];
  /** The cases that call into it now, retained ones included. */
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
  /**
   * Regions an edit beside them renumbered: the address pairs them with a
   * sibling of the same name, and the diff says which sibling they are. They
   * are paired by their lines, so they did not move, and are named here rather
   * than dropped without a word. Absent from an answer written before siblings
   * were paired, which never looked for them: that is not the same as none.
   */
  readonly renumbered?: readonly MovedRegion[];
  /**
   * Rows at the base the diff carried onto a region of another structural path
   * — `if#0/then` onto `if#1/then`, or a `then` onto an `else` — where no edit
   * inside the region holding both could have renumbered it. The base row does
   * not match the text it claims, so the pair is not compared, and is named
   * here rather than read as motion. Absent from an answer written before rows
   * were checked against their path: that is not the same as none.
   */
  readonly mismatched?: readonly MismatchedRow[];
}

/** A base row, as the base places it, and the region now that stands on the lines the diff carried it to. */
export interface MismatchedRow extends MovedRegion {
  readonly path: string;
  readonly now: MovedRegion & { readonly path: string };
}

/** What `caseMotion` may consult, and what it leaves out. */
export interface CaseMotionOptions {
  /** The file graph, which names the stopped cases that could have reached a region. */
  readonly relations?: Relations;
  /** Modules left out of the comparison, such as the ones the base's branch changed since the fork. */
  readonly exclude?: ReadonlySet<string>;
  /**
   * The current record's cases left out of the comparison, which neither
   * `base` nor `now` holds: those that did not run again and retain an earlier
   * recording, cut as `now` is. A region one of them calls into kept that
   * case, so it is counted at both ends, and the region is never lost or
   * gained because the cases that did run moved past it. A module cut
   * otherwise credits none of them.
   */
  readonly retained?: ExecutionIndex;
  /**
   * The `-U0` diff from the text the base was recorded over to the text the
   * current record was, by file, as `hunksByFile` reads it; a file it does not
   * hold did not change. It is the only pairing: a caller that cannot read it
   * has nothing to compare.
   */
  readonly diff: ReadonlyMap<string, readonly Hunk[]>;
}

/**
 * The regions whose cases moved between `base` and `now`.
 *
 * A region is paired by its lines ({@link matchedThrough}): the diff between
 * the two texts carries each row at the base to the lines it stands on now, so
 * a region an edit moved down the file is still the same region. A region only
 * one side holds did not move: the edit wrote or deleted it, and the diff
 * already says so. Neither the address, whose occurrence counts siblings of
 * one name, nor the cases can say which of two siblings an edit wrote between
 * them is new; the diff can. Only calls count; a region entered while its
 * module evaluated was entered by whichever case imported it first.
 */
export function caseMotion(base: ExecutionIndex, now: ExecutionIndex, options: CaseMotionOptions): CaseMotion {
  const regions: RegionMotion[] = [];
  const reach = new Map<string, { entered: MovedRegion[]; left: MovedRegion[] }>();
  const reachOf = (file: string) => {
    let held = reach.get(file);
    if (held === undefined) reach.set(file, (held = { entered: [], left: [] }));
    return held;
  };
  const current = new Map(now.modules.map((module) => [module.file, module]));
  const unread: string[] = [];
  const renumbered: MovedRegion[] = [];
  const mismatched: MismatchedRow[] = [];
  const retained = options.retained;
  const kept = new Map(retained?.modules.map((module) => [module.file, module]));
  for (const held of base.modules) {
    if (options.exclude?.has(held.file) === true) continue;
    const module = current.get(held.file);
    if (module === undefined) {
      unread.push(held.file);
      continue;
    }
    let stopped: ReadonlySet<number> | undefined | null = null;
    const paired = throughLines(held, module, options.diff.get(module.file) ?? []);
    renumbered.push(...paired.renumbered.map((block) => place(module.file, block)));
    for (const [row, block] of paired.mismatched) {
      mismatched.push({ ...place(held.file, row), path: row.path, now: { ...place(module.file, block), path: block.path } });
    }
    const keptBy = keptCallers(retained, kept.get(module.file), module);
    for (const [row, block] of paired.pairs) {
      const region = place(module.file, block);
      const ran = callers(base, row);
      const runs = callers(now, block);
      const was = filesOf(ran);
      const is = filesOf(runs);
      const still = keptBy(block);
      // A retained case the base also holds is one case: counted once at each end.
      const ranIds = new Set(ran.map((test) => test.id));
      const runsIds = new Set(runs.map((test) => test.id));
      const before = [...ran, ...still.filter((test) => !ranIds.has(test.id))];
      const after = [...runs, ...still.filter((test) => !runsIds.has(test.id))];
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
  mismatched.sort((left, right) => (left.file < right.file ? -1 : left.file > right.file ? 1 : left.startLine - right.startLine));
  return { regions, counts, testFiles, unread: unread.sort(), renumbered: inOrder(renumbered), mismatched };
}

function place(file: string, block: ExecutionBlock): MovedRegion {
  return { file, kind: block.kind, name: block.name, startLine: block.startLine, endLine: block.endLine };
}

/** The pairs the diff makes, and the regions now it paired with a row the address would not have. */
function throughLines(
  held: ExecutionModule,
  module: ExecutionModule,
  hunks: readonly Hunk[],
): Paired & { readonly renumbered: readonly ExecutionBlock[] } {
  const { pairs, mismatched } = matchedThrough(held, module, hunks);
  const byAddress = new Map(matched(held, module).map(([row, block]) => [block, row]));
  const renumbered = pairs.filter(([row, block]) => byAddress.has(block) && byAddress.get(block) !== row).map(([, block]) => block);
  return { pairs, mismatched, renumbered };
}

/** Rows paired with regions through the diff, and rows the diff carried onto a region of a path no edit explains. */
export interface Paired {
  readonly pairs: readonly (readonly [ExecutionBlock, ExecutionBlock])[];
  /** Each row with the region it landed on, which it is not paired with. */
  readonly mismatched: readonly (readonly [ExecutionBlock, ExecutionBlock])[];
}

/**
 * The source regions both records hold, each with its row at the base, paired
 * through the diff between the two texts: a row pairs with the region of its
 * kind and name standing on the lines the diff carried it to. A row an edit
 * touched is carried to an approximate range, so it pairs with the nearest
 * region of its kind and name overlapping it, after every untouched row has
 * taken its own. A row the edit removed pairs with nothing, and a region the
 * edit wrote is paired by no row.
 *
 * A row the edit left whole pairs with a region of its own structural path,
 * or with one an edit renumbered ({@link renumberedBy}). A row that lands only
 * on a region of another path is not paired: the base row does not match the
 * text it claims, and it is returned as mismatched with the region it landed on.
 */
export function matchedThrough(
  base: ExecutionModule,
  now: ExecutionModule,
  hunks: readonly Hunk[],
): Paired {
  const named = new Map<string, ExecutionBlock[]>();
  const key = (block: ExecutionBlock) => `${block.kind}\0${block.name}`;
  for (const block of now.blocks) {
    if (!block.source) continue;
    const group = named.get(key(block));
    if (group === undefined) named.set(key(block), [block]);
    else group.push(block);
  }
  const taken = new Set<ExecutionBlock>();
  const pairs: (readonly [ExecutionBlock, ExecutionBlock])[] = [];
  const mismatched: (readonly [ExecutionBlock, ExecutionBlock])[] = [];
  const touched: (readonly [ExecutionBlock, { readonly startLine: number; readonly endLine: number }])[] = [];
  for (const row of base.blocks) {
    const placed = placeThrough(hunks, row);
    if (placed === undefined) continue;
    if (placed.moved) {
      touched.push([row, placed.lines]);
      continue;
    }
    const there = (named.get(key(row)) ?? []).filter((block) =>
      !taken.has(block) && block.startLine === placed.lines.startLine && block.endLine === placed.lines.endLine);
    const block = there.find((one) => one.path === row.path) ?? there.find((one) => renumberedBy(hunks, base, row, one));
    if (block === undefined) {
      if (there[0] !== undefined) mismatched.push([row, there[0]]);
      continue;
    }
    taken.add(block);
    pairs.push([row, block]);
  }
  for (const [row, lines] of touched) {
    let nearest: ExecutionBlock | undefined;
    for (const block of named.get(key(row)) ?? []) {
      if (taken.has(block) || block.startLine > lines.endLine || block.endLine < lines.startLine) continue;
      if (nearest === undefined || Math.abs(block.startLine - lines.startLine) < Math.abs(nearest.startLine - lines.startLine)) nearest = block;
    }
    if (nearest === undefined) continue;
    taken.add(nearest);
    pairs.push([row, nearest]);
  }
  return { pairs, mismatched };
}

/**
 * Whether an edit can have renumbered `row` into `block`: their paths differ
 * only in the occurrence of one segment, and the diff wrote or removed a line
 * between the start of the region holding both and the row. Only a sibling
 * written or removed before it, inside that region, moves an occurrence; an
 * edit above the region moves its lines and leaves its path alone.
 */
function renumberedBy(hunks: readonly Hunk[], base: ExecutionModule, row: ExecutionBlock, block: ExecutionBlock): boolean {
  const was = row.path.split('/');
  const is = block.path.split('/');
  const shape = (segment: string) => segment.replace(/#\d+$/, '');
  if (was.length !== is.length || was.some((segment, at) => shape(segment) !== shape(is[at]!))) return false;
  const at = was.findIndex((segment, index) => segment !== is[index]);
  const holder = at === 0 ? 'entry' : was.slice(0, at).join('/');
  const scope = base.blocks.find((one) => one.name === row.name && one.path === holder &&
    one.startLine <= row.startLine && one.endLine >= row.endLine);
  const from = scope?.startLine ?? 1;
  return hunks.some((hunk) => {
    const last = hunk.oldCount === 0 ? hunk.oldStart : hunk.oldStart + hunk.oldCount - 1;
    return hunk.oldStart < row.startLine && last >= from;
  });
}

/**
 * The source regions both records hold at one address, each with its row at
 * the base: the pairing the diff is checked against to name what it renumbered.
 */
function matched(base: ExecutionModule, now: ExecutionModule): readonly (readonly [ExecutionBlock, ExecutionBlock])[] {
  const held = new Map(regionAddresses(base.blocks));
  const pairs: (readonly [ExecutionBlock, ExecutionBlock])[] = [];
  for (const [address, block] of regionAddresses(now.blocks)) {
    const was = held.get(address);
    if (was !== undefined && was.kind === block.kind && block.source) pairs.push([was, block]);
  }
  return pairs;
}

/**
 * Each of a module's regions with the address the case index carries its cases
 * by: name path and structural path, told apart by occurrence. Two cuts of one
 * module, by two suites or at two commits, name one region by one address.
 */
export function regionAddresses(blocks: readonly ExecutionBlock[]): readonly (readonly [string, ExecutionBlock])[] {
  const seen = new Map<string, number>();
  return blocks.map((block) => [addressKey(`${block.name}\0${block.path}`, seen), block] as const);
}

/**
 * The retained cases that call into each of a module's regions now, read from
 * the same region of the same cut: retained cases are part of the record `now`
 * is cut from, so their module lists the same regions in the same order. A
 * module cut otherwise credits nothing, because an occurrence among siblings
 * of one name can name another sibling there.
 */
function keptCallers(
  retained: ExecutionIndex | undefined,
  held: ExecutionModule | undefined,
  module: ExecutionModule,
): (block: ExecutionBlock) => readonly ExecutionTest[] {
  if (retained === undefined || held === undefined || !sameCut(held, module)) return () => [];
  const at = new Map(module.blocks.map((block, position) => [block, position]));
  return (block) => callers(retained, held.blocks[at.get(block)!]!);
}

function sameCut(left: ExecutionModule, right: ExecutionModule): boolean {
  return left.blocks.length === right.blocks.length && left.blocks.every((block, at) => {
    const other = right.blocks[at]!;
    return block.kind === other.kind && block.name === other.name && block.path === other.path &&
      block.startLine === other.startLine && block.endLine === other.endLine;
  });
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
