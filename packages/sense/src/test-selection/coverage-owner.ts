// compass: variance-authority.reach.crossings
/**
 * Whose tests ran each module's regions: its own package's, or only others'.
 *
 * A line coverage total cannot tell a package that tests itself from one that
 * is run by the tests of whatever imports it, and the two read the same at
 * 100%. The case index can, because it names the case that called into each
 * region and the case names its file. The owner of a file is the caller's
 * answer, not this module's: the package boundary is the manifest's, and only
 * the reader that has the manifests in hand can say which one holds a file.
 *
 * A region counts as run the way {@link countCoverage} counts it: a case
 * called into it. A crossing made while the module evaluated names an import
 * order, not a test aimed at the code, so it counts no package as running the
 * region. A test file is left out, in every suite, once any suite runs it as one: its
 * own tests run it by being it.
 *
 * The same pass says which kind of suite ran each region, and, given the hops
 * {@link testHops} walked, how near the nearest test that ran it stood: one
 * total cannot tell code its unit tests import from code an end-to-end run
 * passed through.
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
   * Per kind of a counted suite, the regions a case of a suite of that kind
   * called into; a kind whose suites ran none of them is `0`. A suite with no
   * kind is in no entry.
   */
  readonly kinds: Readonly<Partial<Record<SuiteKind, number>>>;
  /**
   * Given the walked hops, per hop count, the regions whose nearest test that
   * ran them, in any suite, stood that many imports away.
   */
  readonly nearest?: Readonly<Record<string, number>>;
  /** Given the walked hops, regions run only by tests no walk placed. */
  readonly unmeasured?: number;
}

/**
 * Every module any suite recorded, with its regions counted by the package of
 * the cases that ran them. `ownerOf` names the package of a source file and of
 * a test file alike; files are in code-unit order.
 */
export function coverageByOwner(
  suites: readonly CountedSuite[],
  ownerOf: (file: string) => string,
  walked?: TestHops,
): readonly OwnedFile[] {
  const counted = [...new Set(suites.flatMap((suite) => (suite.kind === undefined ? [] : [suite.kind])))];
  // file → address and kind → who ran the region, how, and from how near.
  const joined = new Map<string, Map<string, Ran>>();
  for (const { suite, file, key, tests } of calledRegions(suites)) {
    let regions = joined.get(file);
    if (regions === undefined) joined.set(file, (regions = new Map()));
    let ran = regions.get(key);
    if (ran === undefined) regions.set(key, (ran = { owners: new Set(), kinds: new Set() }));
    const kind = suites[suite]!.kind;
    if (tests.length > 0 && kind !== undefined) ran.kinds.add(kind);
    for (const test of tests) {
      ran.owners.add(ownerOf(test));
      const hop = walked?.hops.get(test)?.get(file);
      if (hop !== undefined && (ran.nearest === undefined || hop < ran.nearest)) ran.nearest = hop;
    }
  }

  const files: OwnedFile[] = [];
  for (const [file, regions] of joined) {
    const owner = ownerOf(file);
    let run = 0;
    let own = 0;
    let unmeasured = 0;
    const by = new Map<string, number>();
    const kinds = new Map<SuiteKind, number>(counted.map((kind) => [kind, 0]));
    const nearest = new Map<number, number>();
    for (const ran of regions.values()) {
      if (ran.owners.size === 0) continue;
      run += 1;
      for (const kind of ran.kinds) kinds.set(kind, kinds.get(kind)! + 1);
      if (ran.nearest === undefined) unmeasured += 1;
      else nearest.set(ran.nearest, (nearest.get(ran.nearest) ?? 0) + 1);
      if (ran.owners.has(owner)) {
        own += 1;
        continue;
      }
      for (const other of ran.owners) by.set(other, (by.get(other) ?? 0) + 1);
    }
    files.push({
      file, owner, regions: regions.size, run, own, others: run - own, by: sortedKeys(by), kinds: Object.fromEntries(kinds),
      ...(walked === undefined ? {} : { nearest: Object.fromEntries([...nearest].sort(([left], [right]) => left - right)), unmeasured }),
    });
  }
  return files.sort((left, right) => codeUnitOrder(left.file, right.file));
}

/** What ran one region, joined across suites. */
interface Ran {
  /** The packages whose cases called into it. */
  readonly owners: Set<string>;
  /** The kinds of the suites whose cases called into it. */
  readonly kinds: Set<SuiteKind>;
  /** The fewest hops from a test that called into it to its file, when a walk placed one. */
  nearest?: number;
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
  const tests = new Set(suites.flatMap((suite) => suite.index.tests.map((test) => test.file)));
  for (const [suite, { index }] of suites.entries()) {
    for (const module of index.modules) {
      if (tests.has(module.file)) continue;
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

/** The same counts, keyed in code-unit order, so a program reads one order whatever order the record held. */
function sortedKeys(counts: ReadonlyMap<string, number>): Readonly<Record<string, number>> {
  return Object.fromEntries([...counts].sort(([left], [right]) => codeUnitOrder(left, right)));
}
