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
   * sibling of the same name, and their cases say which sibling they are. They
   * are paired by their cases, so they did not move, and are named here rather
   * than dropped without a word. Absent from an answer written before siblings
   * were paired, which never looked for them: that is not the same as none.
   */
  readonly renumbered?: readonly MovedRegion[];
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
}

/**
 * The regions whose cases moved between `base` and `now`.
 *
 * A region is matched by address — name path and structural path, told apart
 * by occurrence — and kind, the rule the case index carries its cases by
 * across runs, so a region an edit moved down the file is still the same
 * region. A region only one side holds did not move: the edit wrote or deleted
 * it, and the diff already says so. The occurrence counts siblings of one name,
 * so deleting the first of three `.filter` callbacks pairs the second with the
 * first: before the address is read, a region at the base and one now of the
 * same kind and name whose cases are the same cases are paired by them. Only calls count; a region entered while
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
  const renumbered: MovedRegion[] = [];
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
    const paired = byCases(base, now, held, module);
    renumbered.push(...paired.renumbered.map((block) => place(module.file, block)));
    const keptBy = keptCallers(retained, kept.get(module.file), module);
    for (const [row, block] of paired.pairs) {
      const region = place(module.file, block);
      const ran = callers(base, row);
      const runs = callers(now, block);
      const was = filesOf(ran);
      const is = filesOf(runs);
      const still = keptBy(block);
      const before = [...ran, ...still];
      const after = [...runs, ...still];
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
  return { regions, counts, testFiles, unread: unread.sort(), renumbered: inOrder(renumbered) };
}

function place(file: string, block: ExecutionBlock): MovedRegion {
  return { file, kind: block.kind, name: block.name, startLine: block.startLine, endLine: block.endLine };
}

/**
 * The pairs `matched` makes, after first pairing each region whose cases name
 * it among siblings of one kind and name: a set of cases one base row and one
 * region now share, and no other sibling on either side holds. A region with
 * no cases names nothing, so it is left to the address. `renumbered` is each
 * region now the cases paired with a row the address would not have.
 */
function byCases(
  base: ExecutionIndex,
  now: ExecutionIndex,
  held: ExecutionModule,
  module: ExecutionModule,
): { readonly pairs: readonly (readonly [ExecutionBlock, ExecutionBlock])[]; readonly renumbered: readonly ExecutionBlock[] } {
  const address = matched(held, module);
  const siblings = (blocks: readonly ExecutionBlock[]) => {
    const groups = new Map<string, ExecutionBlock[]>();
    for (const block of blocks) {
      const key = `${block.kind}\0${block.name}`;
      const group = groups.get(key);
      if (group === undefined) groups.set(key, [block]);
      else group.push(block);
    }
    return groups;
  };
  const was = siblings(held.blocks);
  const cases = new Map<ExecutionBlock, string>();
  const named = (index: ExecutionIndex, block: ExecutionBlock) => {
    let key = cases.get(block);
    if (key === undefined) cases.set(block, (key = callers(index, block).map((test) => test.id).sort().join('\0')));
    return key;
  };
  const chosen = new Map<ExecutionBlock, ExecutionBlock>();
  for (const [key, group] of siblings(module.blocks.filter((block) => block.source))) {
    const rows = was.get(key);
    if (rows === undefined || (rows.length === 1 && group.length === 1)) continue;
    const once = (index: ExecutionIndex, blocks: readonly ExecutionBlock[]) => {
      const seen = new Map<string, ExecutionBlock | null>();
      for (const block of blocks) {
        const set = named(index, block);
        if (set !== '') seen.set(set, seen.has(set) ? null : block);
      }
      return seen;
    };
    const atBase = once(base, rows);
    for (const [set, block] of once(now, group)) {
      const row = atBase.get(set);
      if (block !== null && row !== undefined && row !== null) chosen.set(block, row);
    }
  }
  if (chosen.size === 0) return { pairs: address, renumbered: [] };
  const taken = new Set(chosen.values());
  const pairs: (readonly [ExecutionBlock, ExecutionBlock])[] = [...chosen].map(([block, row]) => [row, block] as const);
  const renumbered: ExecutionBlock[] = [];
  const byAddress = new Map(address.map(([row, block]) => [block, row]));
  for (const [block, row] of chosen) if (byAddress.get(block) !== row) renumbered.push(block);
  for (const [row, block] of address) if (!chosen.has(block) && !taken.has(row)) pairs.push([row, block]);
  return { pairs, renumbered };
}

/**
 * The source regions both records hold, each with its row at the base.
 *
 * Exported so a reader counting what the two records hold joins them the way
 * the motion does, and a region counted as written is one the motion never
 * paired.
 */
export function matched(base: ExecutionModule, now: ExecutionModule): readonly (readonly [ExecutionBlock, ExecutionBlock])[] {
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
