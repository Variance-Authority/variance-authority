// compass: variance-authority.reach.crossings
/**
 * Who ran each module's regions: its own package's tests or only others', and
 * of its own, which kind of suite and from how near. One coverage total reads
 * the same whether a package tests itself or is run by whatever imports it; the
 * case index tells them apart. The owner of a file is the caller's answer: only the reader that
 * holds the manifests can say which package holds a file.
 */

import { codeUnitOrder } from '@variance-authority/core/segment';
import { joinedRegions, type CountedSuite } from './coverage-count.js';
import type { TestHops } from './coverage-distance.js';
import type { SuiteKind } from './suites.js';

/** One recorded source file, and which package's tests ran its regions. */
export interface OwnedFile {
  readonly file: string;
  /** The package the file is in, as the caller's `ownerOf` named it. */
  readonly owner: string;
  /** Source regions any counted suite holds for the file, joined across suites by address. */
  readonly regions: number;
  /** Regions some case called into. */
  readonly run: number;
  /** Regions a case in the file's own package called into. */
  readonly own: number;
  /** Regions only cases in other packages called into: `run − own`. */
  readonly others: number;
  /**
   * Per other package, how many of the `others` regions its cases called into.
   * A region two other packages ran is counted under both, so these do not add
   * up to `others`.
   */
  readonly by: Readonly<Record<string, number>>;
  /**
   * Per kind of a counted suite, the regions a case of the file's own package,
   * in a suite of that kind, called into; a kind whose suites ran none of them
   * is `0`. Absent when a counted suite has no kind, as the overlap of
   * {@link countCoverage} is.
   */
  readonly kinds?: Readonly<Partial<Record<SuiteKind, number>>>;
  /**
   * Given the walked hops, the `own` regions a test of the file's own package
   * called into from at most {@link NEAR_HOPS} imports away: the package
   * contains them next to the code. Another package's test says nothing of how
   * near the package tests itself, however near it stood.
   */
  readonly near?: number;
}

/** The most import hops a test stands from a file it runs and still sits next to it: the test imports the code. */
export const NEAR_HOPS = 1;

/**
 * Whether a test ran a file from next to it, within {@link NEAR_HOPS}, or from
 * further away; absent when no walk measured the distance, which is not a
 * short one. The one answer both {@link coverageByOwner} and `earnedCoverage` read.
 */
export function nearness(walked: TestHops | undefined, test: string, file: string): 'near' | 'far' | undefined {
  const hop = walked?.hops.get(test)?.get(file);
  return hop === undefined ? undefined : hop <= NEAR_HOPS ? 'near' : 'far';
}

/**
 * Every module any suite recorded, with its regions counted by the package of
 * the cases that ran them. `ownerOf` names the package of a source file and of
 * a test file alike; files are in code-unit order. A region counts as run when
 * a case called into it, as {@link countCoverage} counts: a crossing made while
 * the module loaded names an import order, not a test aimed at the code. A test
 * file is left out of every suite once one runs it as a test.
 */
export function coverageByOwner(
  suites: readonly CountedSuite[],
  ownerOf: (file: string) => string,
  walked?: TestHops,
): readonly OwnedFile[] {
  const kinded = suites.every((suite) => suite.kind !== undefined);
  const counted = kinded ? [...new Set(suites.map((suite) => suite.kind!))] : [];
  // file → address and kind → who ran the region, and how and how near its own package's tests did.
  const joined = new Map<string, Map<string, Ran>>();
  const owners = new Map<string, string>();
  for (const { suite, file, key, tests } of calledRegions(suites)) {
    let regions = joined.get(file);
    if (regions === undefined) joined.set(file, (regions = new Map()));
    let ran = regions.get(key);
    if (ran === undefined) regions.set(key, (ran = { owners: new Set(), kinds: new Set(), near: false }));
    let owner = owners.get(file);
    if (owner === undefined) owners.set(file, (owner = ownerOf(file)));
    const kind = suites[suite]!.kind;
    for (const test of tests) {
      const tester = ownerOf(test);
      ran.owners.add(tester);
      if (tester !== owner) continue;
      if (kinded) ran.kinds.add(kind!);
      if (nearness(walked, test, file) === 'near') ran.near = true;
    }
  }

  const files: OwnedFile[] = [];
  for (const [file, regions] of joined) {
    const owner = owners.get(file)!;
    let run = 0;
    let own = 0;
    let near = 0;
    const by = new Map<string, number>();
    const kinds = new Map<SuiteKind, number>(counted.map((kind) => [kind, 0]));
    for (const ran of regions.values()) {
      if (ran.owners.size === 0) continue;
      run += 1;
      for (const kind of ran.kinds) kinds.set(kind, kinds.get(kind)! + 1);
      if (ran.owners.has(owner)) {
        if (ran.near) near += 1;
        own += 1;
        continue;
      }
      for (const other of ran.owners) by.set(other, (by.get(other) ?? 0) + 1);
    }
    files.push({
      file, owner, regions: regions.size, run, own, others: run - own, by: sortedKeys(by),
      ...(kinded ? { kinds: Object.fromEntries(kinds) } : {}), ...(walked === undefined ? {} : { near }),
    });
  }
  return files.sort((left, right) => codeUnitOrder(left.file, right.file));
}

/** What ran one region, joined across suites. */
interface Ran {
  /** The packages whose cases called into it. */
  readonly owners: Set<string>;
  /** The kinds of the suites whose cases of its own package called into it. */
  readonly kinds: Set<SuiteKind>;
  /** Whether a test of its own package called into it from at most {@link NEAR_HOPS} hops. */
  near: boolean;
}

/** One suite's source region, and the test files whose cases called into it. */
export interface CalledRegion {
  /** Which of the given suites holds it. */
  readonly suite: number;
  readonly file: string;
  /** Address and kind, the key regions join by across suites. */
  readonly key: string;
  /** A file once per case that called in; a crossing made at load is left out. */
  readonly tests: readonly string[];
}

/**
 * Every suite's source regions in files no suite runs as a test, each with the
 * test files that called into it: the one pass both who ran a region and how
 * near count over.
 */
export function* calledRegions(suites: readonly CountedSuite[]): Generator<CalledRegion> {
  for (const [suite, { index }] of withoutTests(suites).entries()) {
    for (const module of index.modules) {
      for (const [key, block] of joinedRegions(module.blocks)) {
        const called: string[] = [];
        for (const crossing of block.crossings) {
          const test = index.tests[crossing.test]?.file;
          // A case that ran the region in another text (`overwritten`) is not known to call into this one.
          if (crossing.loaded !== true && crossing.overwritten !== true && test !== undefined) called.push(test);
        }
        yield { suite, file: module.file, key, tests: called };
      }
    }
  }
}

/**
 * The suites with every module some suite runs as a test left out: a test file
 * is the test, not the code it tests, though a suite that runs it records it run.
 */
export function withoutTests<Suite extends CountedSuite>(suites: readonly Suite[]): Suite[] {
  const tests = new Set(suites.flatMap((suite) => suite.index.tests.map((test) => test.file)));
  return suites.map((suite) => ({ ...suite, index: { ...suite.index, modules: suite.index.modules.filter((module) => !tests.has(module.file)) } }));
}

/** The same counts, keyed in code-unit order, so a program reads one order whatever order the record held. */
function sortedKeys(counts: ReadonlyMap<string, number>): Readonly<Record<string, number>> {
  return Object.fromEntries([...counts].sort(([left], [right]) => codeUnitOrder(left, right)));
}
