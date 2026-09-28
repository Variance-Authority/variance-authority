// compass: variance-authority.reach.crossings
/**
 * How much of what the suites loaded each suite ran, and what changed it.
 *
 * A ratio is a count over lists the case index already holds: every region of
 * every module a suite loaded, and the cases that called into each one
 * (ADR-0081). Nothing here reads a second instrument. A region counts as run
 * when a case called into it — the rule `caseMotion` counts by — so the change
 * in a suite's count is exactly its motion plus the regions the edit wrote and
 * deleted, and {@link coverageChange} returns the parts that add up to it.
 *
 * Nothing reads these numbers back. No selector, verdict or exit code takes
 * one as input, and none is written into the record.
 */

import { caseMotion, matched, regionAddresses, type TestFileMotion } from './case-motion.js';
import type { ExecutionBlock, ExecutionIndex } from './reverse.js';
import { SUITE_KINDS, type SuiteKind } from './suites.js';

/** One record to count: a declared suite's, or the repository's one record with no name and no kind. */
export interface CountedSuite {
  readonly name?: string;
  readonly kind?: SuiteKind;
  readonly index: ExecutionIndex;
}

/** What a region's cases did, read off one record. */
export type RegionRun = 'run' | 'load' | 'none';

/** One suite's count over the regions every suite loaded. */
export interface SuiteCount {
  readonly name?: string;
  readonly kind?: SuiteKind;
  /** Regions a case of this suite called into. */
  readonly run: number;
  /** Regions this suite ran only while their module evaluated. */
  readonly load: number;
  /** The source regions this suite's own record holds, in the modules it loaded. */
  readonly regions: number;
}

/** Regions counted by the kinds whose suites ran them. */
export interface KindOverlap {
  /** Regions run by suites of more than one kind. */
  readonly several: number;
  /** Regions run by suites of exactly one kind, per kind, in the order of `SUITE_KINDS`. Only kinds a counted suite has are keys. */
  readonly alone: Readonly<Partial<Record<SuiteKind, number>>>;
}

/** Every counted suite's record over the regions any of them loaded, and how the kinds overlap. */
export interface CoverageCount {
  /** Source regions in every module any suite loaded, joined across suites by address. */
  readonly regions: number;
  /** Modules any suite loaded. */
  readonly files: number;
  /** Regions any suite's case called into. */
  readonly run: number;
  /** Regions no case called into and some suite ran while their module evaluated. */
  readonly load: number;
  /** Regions nothing ran. */
  readonly none: number;
  /** In record order. */
  readonly suites: readonly SuiteCount[];
  /** Absent when a counted suite has no kind: one record with no kind has no overlap to count. */
  readonly overlap?: KindOverlap;
  /**
   * Regions in a module two or more suites loaded that not every one of those
   * suites' cuts holds. Each is counted under the suites that hold it.
   */
  readonly unjoined: number;
}

/** How a record's case calls stand for one region. */
export function regionRun(block: ExecutionBlock): RegionRun {
  let load = block.loaded === true;
  for (const crossing of block.crossings) {
    if (crossing.loaded !== true) return 'run';
    load = true;
  }
  return load ? 'load' : 'none';
}

/** Count every suite's record over the regions any of them loaded. */
export function countCoverage(suites: readonly CountedSuite[]): CoverageCount {
  // file → address and kind → what each suite that holds the region did there.
  const joined = new Map<string, Map<string, (RegionRun | undefined)[]>>();
  const loadedBy = new Map<string, Set<number>>();
  const own = suites.map(() => ({ run: 0, load: 0, regions: 0 }));

  suites.forEach((suite, at) => {
    for (const module of suite.index.modules) {
      let regions = joined.get(module.file);
      if (regions === undefined) joined.set(module.file, (regions = new Map()));
      let holders = loadedBy.get(module.file);
      if (holders === undefined) loadedBy.set(module.file, (holders = new Set()));
      holders.add(at);
      for (const [address, block] of regionAddresses(module.blocks)) {
        if (!block.source) continue;
        const key = `${address}\0${block.kind}`;
        let runs = regions.get(key);
        if (runs === undefined) regions.set(key, (runs = Array.from<RegionRun | undefined>({ length: suites.length })));
        const run = regionRun(block);
        runs[at] = run;
        own[at]!.regions += 1;
        if (run === 'run') own[at]!.run += 1;
        else if (run === 'load') own[at]!.load += 1;
      }
    }
  });

  const kinded = suites.every((suite) => suite.kind !== undefined);
  const alone: Partial<Record<SuiteKind, number>> = {};
  if (kinded) for (const kind of SUITE_KINDS) if (suites.some((suite) => suite.kind === kind)) alone[kind] = 0;
  let regions = 0;
  let run = 0;
  let load = 0;
  let several = 0;
  let unjoined = 0;
  for (const [file, held] of joined) {
    const holders = loadedBy.get(file)!;
    for (const runs of held.values()) {
      regions += 1;
      if (holders.size > 1 && [...holders].some((at) => runs[at] === undefined)) unjoined += 1;
      const kinds = new Set<SuiteKind>();
      let ran = false;
      let loaded = false;
      runs.forEach((one, at) => {
        if (one === 'run') {
          ran = true;
          if (kinded) kinds.add(suites[at]!.kind!);
        } else if (one === 'load') loaded = true;
      });
      if (ran) run += 1;
      else if (loaded) load += 1;
      if (kinds.size > 1) several += 1;
      else if (kinds.size === 1) alone[[...kinds][0]!]! += 1;
    }
  }

  return {
    regions,
    files: joined.size,
    run,
    load,
    none: regions - run - load,
    suites: suites.map((suite, at) => ({
      ...(suite.name === undefined ? {} : { name: suite.name }),
      ...(suite.kind === undefined ? {} : { kind: suite.kind }),
      ...own[at]!,
    })),
    ...(kinded ? { overlap: { several, alone } } : {}),
    unjoined,
  };
}

/** Regions counted, and how many of them a case called into. */
export interface RegionTally {
  readonly regions: number;
  readonly run: number;
}

/**
 * The parts one suite's change in `run` is made of, between two of its records.
 *
 * `now.run − base.run` is `gained − lost − hidden + written.run − deleted.run +
 * arrived.run − departed.run`, and `now.regions − base.regions` is the same sum
 * over `regions`. `thinned` changes no count and is here because the motion
 * names it.
 */
export interface SuiteChange {
  readonly gained: number;
  readonly lost: number;
  readonly hidden: number;
  readonly thinned: number;
  /** Regions only the current record holds, in modules both records hold. */
  readonly written: RegionTally;
  /** Regions only the base holds, in modules both records hold. */
  readonly deleted: RegionTally;
  /** Modules only the current record holds: the suite loads them now and did not. */
  readonly arrived: RegionTally & { readonly files: readonly string[] };
  /** Modules only the base holds: the suite loaded them and does not now. */
  readonly departed: RegionTally & { readonly files: readonly string[] };
  /** Every test file whose reach changed, as the motion names them. */
  readonly testFiles: readonly TestFileMotion[];
}

/** What changed one suite's count between `base` and `now`. */
export function coverageChange(base: ExecutionIndex, now: ExecutionIndex): SuiteChange {
  const motion = caseMotion(base, now);
  const current = new Map(now.modules.map((module) => [module.file, module]));
  const held = new Set(base.modules.map((module) => module.file));
  const written = { regions: 0, run: 0 };
  const deleted = { regions: 0, run: 0 };
  const arrived = { regions: 0, run: 0, files: [] as string[] };
  const departed = { regions: 0, run: 0, files: [] as string[] };
  const tally = (into: { regions: number; run: number }, blocks: Iterable<ExecutionBlock>) => {
    for (const block of blocks) {
      if (!block.source) continue;
      into.regions += 1;
      if (regionRun(block) === 'run') into.run += 1;
    }
  };

  for (const was of base.modules) {
    const module = current.get(was.file);
    if (module === undefined) {
      departed.files.push(was.file);
      tally(departed, was.blocks);
      continue;
    }
    const pairs = matched(was, module);
    const paired = { base: new Set(pairs.map(([row]) => row)), now: new Set(pairs.map(([, block]) => block)) };
    tally(deleted, was.blocks.filter((block) => !paired.base.has(block)));
    tally(written, module.blocks.filter((block) => !paired.now.has(block)));
  }
  for (const module of now.modules) {
    if (held.has(module.file)) continue;
    arrived.files.push(module.file);
    tally(arrived, module.blocks);
  }

  return {
    gained: motion.counts.gained,
    lost: motion.counts.lost,
    hidden: motion.counts.hidden,
    thinned: motion.counts.thinned,
    written,
    deleted,
    arrived: { ...arrived, files: arrived.files.sort() },
    departed: { ...departed, files: departed.files.sort() },
    testFiles: motion.testFiles,
  };
}
