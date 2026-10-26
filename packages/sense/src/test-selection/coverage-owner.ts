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
 * region. A test file is left out: its own tests run it by being it.
 */

import { codeUnitOrder } from '@variance-authority/core/segment';
import { regionAddresses } from './case-motion.js';
import type { CountedSuite } from './coverage-count.js';

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
}

/**
 * Every module any suite recorded, with its regions counted by the package of
 * the cases that ran them. `ownerOf` names the package of a source file and of
 * a test file alike; files are in code-unit order.
 */
export function coverageByOwner(suites: readonly CountedSuite[], ownerOf: (file: string) => string): readonly OwnedFile[] {
  // file → address and kind → the packages whose cases called into the region.
  const joined = new Map<string, Map<string, Set<string>>>();
  for (const suite of suites) {
    const owners = suite.index.tests.map((test) => ownerOf(test.file));
    const tests = new Set(suite.index.tests.map((test) => test.file));
    for (const module of suite.index.modules) {
      if (tests.has(module.file)) continue;
      let regions = joined.get(module.file);
      if (regions === undefined) joined.set(module.file, (regions = new Map()));
      for (const [address, block] of regionAddresses(module.blocks)) {
        if (!block.source) continue;
        const key = `${address}\0${block.kind}`;
        let ran = regions.get(key);
        if (ran === undefined) regions.set(key, (ran = new Set()));
        for (const crossing of block.crossings) {
          const owner = owners[crossing.test];
          if (crossing.loaded !== true && owner !== undefined) ran.add(owner);
        }
      }
    }
  }

  const files: OwnedFile[] = [];
  for (const [file, regions] of joined) {
    const owner = ownerOf(file);
    let run = 0;
    let own = 0;
    const by: Record<string, number> = {};
    for (const ran of regions.values()) {
      if (ran.size === 0) continue;
      run += 1;
      if (ran.has(owner)) {
        own += 1;
        continue;
      }
      for (const other of ran) by[other] = (by[other] ?? 0) + 1;
    }
    files.push({ file, owner, regions: regions.size, run, own, others: run - own, by: sortedKeys(by) });
  }
  return files.sort((left, right) => codeUnitOrder(left.file, right.file));
}

/** The same counts, keyed in code-unit order, so a program reads one order whatever order the record held. */
function sortedKeys(counts: Readonly<Record<string, number>>): Readonly<Record<string, number>> {
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => codeUnitOrder(left, right)));
}
