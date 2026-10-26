// compass: variance-authority.reach.crossings
/**
 * Coverage counted only from the tests that sit a given number of import hops
 * from the code they ran.
 *
 * A module at 100% can be run entirely by a test five imports away, and a
 * refactor that splits a component into three files keeps the total while
 * every new file is reached only through the old one. The total cannot say
 * that; the distance can. The hops are the ones {@link hopsFromTest} walks:
 * from the test's file, over the modules that test entered, so a distance is
 * one the run travelled and not one an import it never took could have made.
 *
 * The band narrows the crossings and leaves the regions, so every count read
 * over the narrowed index keeps its denominator: what the suites loaded. A
 * test file the graph cannot place is left out of every band, since an
 * unmeasured distance is not a short one, and named so the answer can say so.
 * Hops are per test file, the grain the record places.
 */

import { codeUnitOrder } from '@variance-authority/core/segment';
import { hopsFromTest, type DistanceOptions } from './distance.js';
import type { ExecutionIndex } from './reverse.js';

/** The index with only the crossings of tests within the band, and the test files no walk could place. */
export interface CoverageAtDistance {
  readonly index: ExecutionIndex;
  /** In code-unit order. */
  readonly unplaced: readonly string[];
}

/** Keep each crossing whose test file is between `from` and `to` import hops of the module it entered, both ends included. */
export function coverageAtDistance(
  index: ExecutionIndex,
  band: { readonly from: number; readonly to: number },
  options: DistanceOptions,
): CoverageAtDistance {
  // test file → every module a case of it entered, loading included: a module
  // that only loaded still carried the import the walk goes through.
  const entered = new Map<string, Set<string>>();
  for (const module of index.modules) {
    for (const block of module.blocks) {
      for (const crossing of block.crossings) {
        const file = index.tests[crossing.test]?.file;
        if (file === undefined) continue;
        let modules = entered.get(file);
        if (modules === undefined) entered.set(file, (modules = new Set()));
        modules.add(module.file);
      }
    }
  }

  const hops = new Map<string, ReadonlyMap<string, number>>();
  const unplaced: string[] = [];
  for (const [file, modules] of entered) {
    const walked = hopsFromTest(file, modules, options);
    if ('because' in walked) unplaced.push(file);
    else hops.set(file, walked);
  }

  const within = (test: number, module: string): boolean => {
    const distance = hops.get(index.tests[test]?.file ?? '')?.get(module);
    return distance !== undefined && distance >= band.from && distance <= band.to;
  };
  return {
    index: {
      ...index,
      modules: index.modules.map((module) => ({
        ...module,
        blocks: module.blocks.map((block) => ({ ...block, crossings: block.crossings.filter((crossing) => within(crossing.test, module.file)) })),
      })),
    },
    unplaced: unplaced.sort(codeUnitOrder),
  };
}
