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

import { caseMotion, matchedThrough, regionAddresses, type CaseMotionOptions, type TestFileMotion } from './case-motion.js';
import type { ExecutionBlock, ExecutionCrossing, ExecutionIndex } from './reverse.js';
import { SUITE_KINDS, type SuiteKind } from './suites.js';

/** One record to count: a declared suite's, or the repository's one record with no name and no kind. */
export interface CountedSuite {
  readonly name?: string;
  readonly kind?: SuiteKind;
  readonly index: ExecutionIndex;
  /**
   * Which text a test file ran a region over, asked of every test file whose
   * case called into it. Absent, the count does not part what ran when no
   * suite says, and counts this suite's runs as not known when another does.
   */
  readonly textOf?: (file: string, region: ExecutionBlock, testFile: string) => RegionText;
}

/**
 * The text a test file ran a region over: the one in the checkout, an older
 * one an edit since touched the region in, or not known, for the named reason.
 */
export type RegionText = 'this' | 'older' | { readonly unknown: string };

/**
 * The regions counted as run, parted by the text their cases ran: `this +
 * older + notKnown` is `run`. A region run over this text is one whose own text
 * is the checkout's; what it calls may have changed since.
 */
export interface RunOver {
  /** A case ran the region over the text in the checkout. */
  readonly this: number;
  /** Every case that called into the region ran it before an edit touched it. */
  readonly older: number;
  /** No case is known to have run this text, and for one of them the text it ran is not known. */
  readonly notKnown: number;
}

/** What a region's cases did, read off one record. */
export type RegionRun = 'run' | 'load' | 'none';

/** One suite's count over the regions every suite loaded. */
export interface SuiteCount {
  readonly name?: string;
  readonly kind?: SuiteKind;
  /** Regions a case of this suite called into, over any text: `over` says how many over this one. */
  readonly run: number;
  /** Regions this suite ran only while their module evaluated. */
  readonly load: number;
  /** The source regions this suite's own record holds, in the modules it loaded. */
  readonly regions: number;
  /** `run`, parted by the text it ran over. Absent when no counted suite says which text it ran. */
  readonly over?: RunOver;
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
  /** Regions any suite's case called into, over any text: `over` says how many over this one. */
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
  /**
   * `run`, parted by the text it ran over, and why a text was not known, each
   * reason once, in code-unit order. Absent when no suite says which text it
   * ran.
   */
  readonly over?: RunOver & { readonly why: readonly string[] };
}

/**
 * How a record's case calls stand for one region. A case that ran the region
 * in another text (`overwritten`) is not known to run this one, so it counts
 * as neither a run nor a load.
 */
export function regionRun(block: ExecutionBlock): RegionRun {
  let load = block.loaded === true;
  for (const crossing of block.crossings) {
    if (calls(crossing)) return 'run';
    if (crossing.overwritten !== true) load = true;
  }
  return load ? 'load' : 'none';
}

/** Whether a crossing is a case calling into its region over the text the record holds: neither a load nor a run over another text. */
function calls(crossing: ExecutionCrossing): boolean {
  return crossing.overwritten !== true && crossing.loaded !== true;
}

/**
 * Per module of `index`, the test files whose cases called into one of its
 * regions: every pair a count asks `textOf` about, so a reader can read them
 * before the count runs.
 */
export function textAsks(index: ExecutionIndex): ReadonlyMap<string, ReadonlySet<string>> {
  const asks = new Map<string, Set<string>>();
  for (const module of index.modules) {
    for (const block of module.blocks) {
      for (const crossing of block.crossings) {
        if (!calls(crossing)) continue;
        let tests = asks.get(module.file);
        if (tests === undefined) asks.set(module.file, (tests = new Set()));
        tests.add(index.tests[crossing.test]!.file);
      }
    }
  }
  return asks;
}

/**
 * A module's source regions, each under the key that joins it to the same
 * region in another suite's record of the module: its address and its kind.
 */
export function* joinedRegions(blocks: readonly ExecutionBlock[]): Generator<readonly [string, ExecutionBlock]> {
  for (const [address, block] of regionAddresses(blocks)) if (block.source) yield [`${address}\0${block.kind}`, block];
}

/**
 * The text a suite ran a region over, folded across the test files whose
 * cases called into it: one over this text vouches for the region; otherwise
 * one not known keeps it from counting as older.
 */
function textRun(index: ExecutionIndex, file: string, block: ExecutionBlock, textOf: NonNullable<CountedSuite['textOf']>): RegionText {
  let unknown: RegionText | undefined;
  // Made at the first test file that does not vouch, so a region run over this text allocates nothing.
  let asked: Set<string> | undefined;
  for (const crossing of block.crossings) {
    if (!calls(crossing)) continue;
    const test = index.tests[crossing.test]!.file;
    if (asked?.has(test) === true) continue;
    (asked ??= new Set()).add(test);
    const text = textOf(file, block, test);
    if (text === 'this') return text;
    if (text !== 'older') unknown ??= text;
  }
  return unknown ?? 'older';
}

/**
 * The fold of {@link textRun} across the suites that ran a region, by the same
 * precedence. `texts` holds only the answers that are not this text, so a suite
 * that ran the region and holds none vouches for it.
 */
function joinText(runs: readonly (RegionRun | undefined)[], texts: readonly (RegionText | undefined)[] | undefined): RegionText {
  if (texts === undefined) return 'this';
  let unknown: RegionText | undefined;
  for (let at = 0; at < runs.length; at += 1) {
    if (runs[at] !== 'run') continue;
    const text = texts[at];
    if (text === undefined) return 'this';
    if (text !== 'older') unknown ??= text;
  }
  return unknown ?? 'older';
}

/** Count every suite's record over the regions any of them loaded. */
export function countCoverage(suites: readonly CountedSuite[]): CoverageCount {
  // file → address and kind → what each suite that holds the region did there.
  const joined = new Map<string, Map<string, (RegionRun | undefined)[]>>();
  // A region's runs → the text each suite that ran it ran it over, held only where that is not this text.
  const texts = new Map<readonly (RegionRun | undefined)[], (RegionText | undefined)[]>();
  const loadedBy = new Map<string, Set<number>>();
  const own = suites.map(() => ({ run: 0, load: 0, regions: 0, older: 0, notKnown: 0 }));
  const parted = suites.some((suite) => suite.textOf !== undefined);
  // Beside a suite that says, one that does not vouches for nothing.
  const unsaid = suites.map((suite): RegionText => ({
    unknown: `the ${suite.name === undefined ? 'record' : `suite \`${suite.name}\``} does not say which text it ran`,
  }));

  suites.forEach((suite, at) => {
    for (const module of suite.index.modules) {
      let regions = joined.get(module.file);
      if (regions === undefined) joined.set(module.file, (regions = new Map()));
      let holders = loadedBy.get(module.file);
      if (holders === undefined) loadedBy.set(module.file, (holders = new Set()));
      holders.add(at);
      for (const [key, block] of joinedRegions(module.blocks)) {
        let runs = regions.get(key);
        if (runs === undefined) regions.set(key, (runs = Array.from<RegionRun | undefined>({ length: suites.length })));
        const run = regionRun(block);
        runs[at] = run;
        own[at]!.regions += 1;
        if (run === 'run') {
          own[at]!.run += 1;
          const text = suite.textOf !== undefined ? textRun(suite.index, module.file, block, suite.textOf) : parted ? unsaid[at]! : 'this';
          if (text === 'older') own[at]!.older += 1;
          else if (text !== 'this') own[at]!.notKnown += 1;
          if (text !== 'this') {
            let ran = texts.get(runs);
            if (ran === undefined) texts.set(runs, (ran = Array.from<RegionText | undefined>({ length: suites.length })));
            ran[at] = text;
          }
        } else if (run === 'load') own[at]!.load += 1;
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
  let older = 0;
  let notKnown = 0;
  const why = new Set<string>();
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
      if (ran) {
        run += 1;
        const text = joinText(runs, texts.get(runs));
        if (text === 'older') older += 1;
        else if (text !== 'this') {
          notKnown += 1;
          why.add(text.unknown);
        }
      } else if (loaded) load += 1;
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
    suites: suites.map((suite, at) => {
      const { older: past, notKnown: unknown, ...counted } = own[at]!;
      return {
        ...(suite.name === undefined ? {} : { name: suite.name }),
        ...(suite.kind === undefined ? {} : { kind: suite.kind }),
        ...counted,
        ...(parted ? { over: { this: counted.run - past - unknown, older: past, notKnown: unknown } } : {}),
      };
    }),
    ...(kinded ? { overlap: { several, alone } } : {}),
    unjoined,
    ...(parted ? { over: { this: run - older - notKnown, older, notKnown, why: [...why].sort() } } : {}),
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
 * `now.run − base.run` is `gained − lost − hidden − unmeasured + written.run −
 * deleted.run + arrived.run − departed.run`, and `now.regions − base.regions` is
 * the same sum over `regions`. `thinned` changes no count and is here because
 * the motion names it.
 */
export interface SuiteChange {
  readonly gained: number;
  readonly lost: number;
  readonly hidden: number;
  readonly thinned: number;
  /**
   * Regions run at the base that no case is recorded running now, where a case
   * that ran one last ran before an edit to its file and the record carried it
   * over the edit without it ({@link CaseMotion.unmeasured}): whether it still
   * runs there was not measured.
   */
  readonly unmeasured: number;
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

/**
 * What changed one suite's count between `base` and `now`. Regions are paired
 * through the diff between the texts the two were recorded over, as the motion
 * pairs them.
 */
export function coverageChange(base: ExecutionIndex, now: ExecutionIndex, options: Pick<CaseMotionOptions, 'diff' | 'stands'>): SuiteChange {
  const motion = caseMotion(base, now, options);
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
    // A mismatched row is not compared, so it counts as neither deleted nor written.
    const { pairs, mismatched } = matchedThrough(was, module, options.diff.get(module.file) ?? []);
    const compared = [...pairs, ...mismatched];
    const paired = { base: new Set(compared.map(([row]) => row)), now: new Set(compared.map(([, block]) => block)) };
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
    unmeasured: (motion.unmeasured ?? []).filter((region) => region.now.length === 0).length,
    written,
    deleted,
    arrived: { ...arrived, files: arrived.files.sort() },
    departed: { ...departed, files: departed.files.sort() },
    testFiles: motion.testFiles,
  };
}
