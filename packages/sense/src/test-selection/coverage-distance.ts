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
 * A region counts under the band of the nearest test that ran it, in any
 * suite, so `2-` holds only what no test within one hop ran and the bands
 * partition what ran. The band narrows the crossings and leaves the regions,
 * so every count read over the narrowed indexes keeps its denominator: what
 * the suites loaded. A
 * test file the graph cannot place is left out of every band, since an
 * unmeasured distance is not a short one, and named so the answer can say so.
 * Hops are per test file, the grain the record places.
 */

import { codeUnitOrder } from '@variance-authority/core/segment';
import { joinedRegions } from './coverage-count.js';
import { hopsFromTest, type DistanceOptions } from './distance.js';
import type { ExecutionBlock, ExecutionIndex } from './reverse.js';

/** Each index with only the crossings of its regions' nearest tests within the band, and what no walk measured. */
export interface CoverageAtDistance {
  readonly indexes: readonly ExecutionIndex[];
  /** Test files the graph does not hold, in code-unit order. */
  readonly unplaced: readonly string[];
  /** Source regions some test called into, none from a measured distance: in no band. */
  readonly unmeasured: number;
}

/** Every test file's import hops to the modules it entered, and the test files no walk could start from. */
export interface TestHops {
  /** test file → module → hops. A module the walk did not reach is absent. */
  readonly hops: ReadonlyMap<string, ReadonlyMap<string, number>>;
  /** Test files the graph does not hold, in code-unit order. */
  readonly unplaced: readonly string[];
}

/**
 * Walk from every test file any index names, over the modules its cases
 * entered, loading included: a module that only loaded still carried the
 * import the walk goes through. One walk per test file, whatever suites name it.
 */
export function testHops(indexes: readonly ExecutionIndex[], options: DistanceOptions): TestHops {
  const entered = new Map<string, Set<string>>();
  for (const index of indexes) {
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
  }

  const hops = new Map<string, ReadonlyMap<string, number>>();
  const unplaced: string[] = [];
  for (const [file, modules] of entered) {
    const walked = hopsFromTest(file, modules, options);
    if ('because' in walked) unplaced.push(file);
    else hops.set(file, walked);
  }
  return { hops, unplaced: unplaced.sort(codeUnitOrder) };
}

/**
 * Keep the crossings of each region whose nearest test is between `from` and
 * `to` import hops of it, both ends included, and of those only the ones made
 * from within the band. A crossing that only loaded the module places nothing
 * and stays in every band, so what loaded is the same under any band.
 */
export function coverageAtDistance(
  indexes: readonly ExecutionIndex[],
  band: { readonly from: number; readonly to: number },
  walked: TestHops,
): CoverageAtDistance {
  const distance = (index: ExecutionIndex, test: number, module: string): number | undefined =>
    walked.hops.get(index.tests[test]?.file ?? '')?.get(module);

  // A source region joins across suites by its address; any other block is its own region.
  const keyOf = new Map<ExecutionBlock, string>();
  const regions = new Set<string>();
  indexes.forEach((index, at) => {
    for (const module of index.modules) {
      for (const [key, block] of joinedRegions(module.blocks)) {
        keyOf.set(block, `${module.file}\0${key}`);
        regions.add(`${module.file}\0${key}`);
      }
      module.blocks.forEach((block, nth) => {
        if (!keyOf.has(block)) keyOf.set(block, `${at}\0${module.file}\0${nth}`);
      });
    }
  });
  const nearest = new Map<string, number>();
  const ran = new Set<string>();
  for (const index of indexes) {
    for (const module of index.modules) {
      for (const block of module.blocks) {
        const key = keyOf.get(block)!;
        for (const crossing of block.crossings) {
          // Loading a module runs its top level for whoever imported it first, so it places nothing.
          if (crossing.loaded === true) continue;
          ran.add(key);
          const hop = distance(index, crossing.test, module.file);
          if (hop !== undefined && hop < (nearest.get(key) ?? Infinity)) nearest.set(key, hop);
        }
      }
    }
  }

  const inBand = (hop: number | undefined): boolean => hop !== undefined && hop >= band.from && hop <= band.to;
  return {
    indexes: indexes.map((index) => ({
      ...index,
      modules: index.modules.map((module) => ({
        ...module,
        blocks: module.blocks.map((block) => inBand(nearest.get(keyOf.get(block)!))
          ? { ...block, crossings: block.crossings.filter((crossing) => crossing.loaded === true || inBand(distance(index, crossing.test, module.file))) }
          : { ...block, crossings: block.crossings.filter((crossing) => crossing.loaded === true) }),
      })),
    })),
    unplaced: walked.unplaced,
    unmeasured: [...ran].filter((key) => regions.has(key) && !nearest.has(key)).length,
  };
}
