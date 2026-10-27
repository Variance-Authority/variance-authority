// compass: variance-authority.reach.crossings
/**
 * How many test files each region and each file sends to a change: selection
 * read backwards, for every file at once. A region one test file ran is one
 * deletion from running unobserved; a file that sends half the suite to every
 * edit is where selection saves nothing. Nothing here is a verdict: no
 * threshold, the distribution and the files at each end (ADR-0098).
 */

import { codeUnitOrder } from '@variance-authority/core/segment';
import type { CountedSuite } from './coverage-count.js';
import { calledRegions } from './coverage-owner.js';
import type { SuiteKind } from './suites.js';

/** One kind's distribution of test files per region, over the regions its suites ran. */
export interface FanInKind {
  /** Absent for the one record of a repository that declares no suites. */
  readonly kind?: SuiteKind;
  /** Test files the kind's suites recorded. */
  readonly testFiles: number;
  /** Regions some test file of the kind called into. */
  readonly regions: number;
  /** Of those, the regions exactly one test file of the kind called into. */
  readonly one: number;
  /** Nearest-rank percentiles of test files per region. */
  readonly median: number;
  readonly p90: number;
  readonly max: number;
}

/** One source file, and the test files that called into it. */
export interface FanInFile {
  readonly file: string;
  /** Source regions any suite holds for the file, joined across suites by address. */
  readonly regions: number;
  /** Regions a test file called into. */
  readonly run: number;
  /** Regions exactly one test file called into, across every suite. */
  readonly one: number;
  /** Test files that called into any region of the file. */
  readonly entered: number;
  /** `entered` per kind, in the order of the counted suites. Absent when a counted suite has no kind. */
  readonly by?: Readonly<Partial<Record<SuiteKind, number>>>;
  /** Test files behind the file's busiest region. */
  readonly peak: number;
  /**
   * Test files behind the file's median run region, by nearest rank. A file
   * that is selected whole sends `entered` to an edit its median region would
   * have sent `median` to: the gap is what selecting by region would save, and
   * the most a split could, since each part still sends every test file that
   * called into it.
   */
  readonly median: number;
  /** Test files the suites that hold the file recorded. */
  readonly testFiles: number;
  /** `entered / testFiles`. */
  readonly share: number;
  /** The `entered` test files' share of those suites' time. Absent when a case was not timed. */
  readonly duration?: number;
}

/** How many test files called into each region: per kind, and per file. */
export interface FanIn {
  /** In the order of the counted suites, one row per kind. */
  readonly kinds: readonly FanInKind[];
  /** Every recorded source file, in code-unit order. */
  readonly files: readonly FanInFile[];
}

/**
 * Count, for every region and every file the suites recorded, the test files
 * that called into it, the way {@link calledRegions} counts a call: a crossing
 * made while the module evaluated is not one. An edit also sends the test
 * files that only loaded the region, which `coveringTests` names per file.
 */
export function coverageFanIn(suites: readonly CountedSuite[]): FanIn {
  const kinded = suites.every((suite) => suite.kind !== undefined);
  const kindOf = (at: number): SuiteKind | undefined => (kinded ? suites[at]!.kind : undefined);
  // A test file is a file of one suite: two suites running one path are two runs of it.
  const testOf = (at: number, file: string) => `${at}\0${file}`;

  // kind → region (file, key) → test files.
  const perKind = new Map<SuiteKind | undefined, Map<string, Set<string>>>();
  // file → key → test files, across suites.
  const perFile = new Map<string, Map<string, Set<string>>>();
  for (const { suite, file, key, tests } of calledRegions(suites)) {
    const called = tests.map((one) => testOf(suite, one));
    let regions = perFile.get(file);
    if (regions === undefined) perFile.set(file, (regions = new Map()));
    let all = regions.get(key);
    if (all === undefined) regions.set(key, (all = new Set()));
    for (const one of called) all.add(one);
    if (called.length === 0) continue;
    let kind = perKind.get(kindOf(suite));
    if (kind === undefined) perKind.set(kindOf(suite), (kind = new Map()));
    let region = kind.get(`${file}\0${key}`);
    if (region === undefined) kind.set(`${file}\0${key}`, (region = new Set()));
    for (const one of called) region.add(one);
  }

  const files = new Map<SuiteKind | undefined, Set<string>>();
  const timed = new Map<string, number | undefined>();
  suites.forEach(({ index }, at) => {
    let held = files.get(kindOf(at));
    if (held === undefined) files.set(kindOf(at), (held = new Set()));
    for (const test of index.tests) {
      const key = testOf(at, test.file);
      held.add(key);
      const was = timed.has(key) ? timed.get(key) : 0;
      timed.set(key, was === undefined || test.duration === undefined ? undefined : was + test.duration);
    }
  });

  const kinds: FanInKind[] = [];
  for (const kind of new Set(suites.map((_, at) => kindOf(at)))) {
    const counts = [...(perKind.get(kind)?.values() ?? [])].map((tests) => tests.size).sort((a, b) => a - b);
    kinds.push({
      ...(kind === undefined ? {} : { kind }),
      testFiles: files.get(kind)?.size ?? 0,
      regions: counts.length,
      one: counts.filter((count) => count === 1).length,
      median: rank(counts, 0.5),
      p90: rank(counts, 0.9),
      max: counts.at(-1) ?? 0,
    });
  }

  // file → the suites that hold it; per set of holders, the test files they recorded and their time.
  const holdersOf = new Map<string, number[]>();
  suites.forEach(({ index }, at) => {
    for (const { file } of index.modules) {
      let holders = holdersOf.get(file);
      if (holders === undefined) holdersOf.set(file, (holders = []));
      if (holders.at(-1) !== at) holders.push(at);
    }
  });
  const pools = new Map<string, { readonly all: ReadonlySet<string>; readonly whole: number | undefined }>();
  const poolOf = (holders: readonly number[]) => {
    const key = holders.join(',');
    let pool = pools.get(key);
    if (pool === undefined) {
      const all = new Set(holders.flatMap((at) => suites[at]!.index.tests.map((test) => testOf(at, test.file))));
      pools.set(key, (pool = { all, whole: wholeTime(all, timed) }));
    }
    return pool;
  };

  const rows: FanInFile[] = [];
  for (const [file, regions] of perFile) {
    const entered = new Set<string>();
    let run = 0;
    let one = 0;
    const counts: number[] = [];
    for (const tests of regions.values()) {
      if (tests.size === 0) continue;
      run += 1;
      if (tests.size === 1) one += 1;
      counts.push(tests.size);
      for (const test of tests) entered.add(test);
    }
    counts.sort((a, b) => a - b);
    const holders = holdersOf.get(file) ?? [];
    const { all, whole } = poolOf(holders);
    const by: Partial<Record<SuiteKind, number>> = {};
    if (kinded) {
      for (const at of holders) by[suites[at]!.kind!] = 0;
      for (const test of entered) by[suites[Number(test.slice(0, test.indexOf('\0')))]!.kind!]! += 1;
    }
    const time = whole === undefined ? undefined : spent(entered, timed) / whole;
    rows.push({
      file,
      regions: regions.size,
      run,
      one,
      entered: entered.size,
      ...(kinded ? { by } : {}),
      peak: counts.at(-1) ?? 0,
      median: rank(counts, 0.5),
      testFiles: all.size,
      share: all.size === 0 ? 0 : entered.size / all.size,
      ...(time === undefined ? {} : { duration: time }),
    });
  }
  return { kinds, files: rows.sort((left, right) => codeUnitOrder(left.file, right.file)) };
}

/** The nearest-rank percentile of ascending counts; 0 over none. */
function rank(ascending: readonly number[], at: number): number {
  if (ascending.length === 0) return 0;
  return ascending[Math.max(0, Math.ceil(at * ascending.length) - 1)]!;
}

/** The time `pool` takes, or `undefined` when a test file in it was not timed or it took none. */
function wholeTime(pool: ReadonlySet<string>, timed: ReadonlyMap<string, number | undefined>): number | undefined {
  let whole = 0;
  for (const test of pool) {
    const time = timed.get(test);
    if (time === undefined) return undefined;
    whole += time;
  }
  return whole === 0 ? undefined : whole;
}

/** The time a part of a fully timed pool takes. */
function spent(part: ReadonlySet<string>, timed: ReadonlyMap<string, number | undefined>): number {
  let some = 0;
  for (const test of part) some += timed.get(test)!;
  return some;
}
