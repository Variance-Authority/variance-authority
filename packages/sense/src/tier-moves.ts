/**
 * Which packages changed tier between two code maps, told as the few changes
 * that caused it and the count each one carried along — the report
 * `layer-moves.ts` makes for layers, over closure sizes instead of depths.
 *
 * A package's closure grows when its own shipped lines grow, when it takes a
 * new package, or when anything it pulls in grows. So a **cause** is a package
 * whose own lines or own package edges changed; a package whose tier moved
 * while neither did is **carried**, and is counted under the cause found by
 * following a dependency whose closure changed size. A package whose tier
 * moved with no such dependency — its closure changed through code no package
 * owns — is its own cause, with nothing of its own changed.
 *
 * Both sides are placed under one list of budgets, the head's, so a change to
 * the budgets does not read as every package moving. A move is a change in
 * tier number: `3` to `≤ 3` is the same tier seen through less of the code.
 * It performs no I/O.
 */

// compass: variance-authority.reach.relations

import type { NativeOrientPackageLayer as PackageLayer } from './native-orient.js';
import { tierOf, type TierPlace, type Tiers } from './tiers.js';

/** One package whose own code or own package edges changed, and what its tier did. */
export interface TierCause {
  readonly package: string;
  readonly from: TierPlace;
  readonly to: TierPlace;
  /** Effective lines of its closure on each side. */
  readonly linesFrom: number;
  readonly linesTo: number;
  /** Effective lines in its own shipped files on each side. */
  readonly ownFrom: number;
  readonly ownTo: number;
  /** Packages it started importing, in code-unit order. */
  readonly added: readonly string[];
  /** Packages it stopped importing, in code-unit order. */
  readonly removed: readonly string[];
  /** Packages whose tier moved only because of this one, in code-unit order. */
  readonly carried: readonly string[];
}

/** The tier moves between two code maps. */
export interface TierMoves {
  /** Largest cascade first, then name. A cause whose own tier held appears only when it carried one that moved. */
  readonly causes: readonly TierCause[];
  /** The sum of every cause's `carried`. */
  readonly carried: number;
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function without(names: readonly string[], others: readonly string[]): string[] {
  const held = new Set(others);
  return names.filter((name) => !held.has(name));
}

/** Compare two maps' packages under the head's budgets; each list is one map's `packages`. */
export function tierMoves(base: readonly PackageLayer[], head: readonly PackageLayer[], tiers: Tiers): TierMoves {
  const before = new Map(base.map((entry) => [entry.package, entry]));
  const pairs = new Map<string, { from: PackageLayer; to: PackageLayer }>();
  for (const to of head) {
    const from = before.get(to.package);
    if (from !== undefined) pairs.set(to.package, { from, to });
  }
  const own = (name: string): boolean => {
    const { from, to } = pairs.get(name)!;
    return from.own !== to.own || without(to.takes, from.takes).length > 0 || without(from.takes, to.takes).length > 0;
  };
  const grew = (name: string): boolean => {
    const pair = pairs.get(name);
    return pair !== undefined && (pair.from.lines !== pair.to.lines || pair.from.unsizedFiles !== pair.to.unsizedFiles);
  };
  const place = (entry: PackageLayer): TierPlace => tierOf(tiers, entry);
  const moved = [...pairs.entries()].filter(([, { from, to }]) => place(from).tier !== place(to).tier).map(([name]) => name);

  // Each package's cause and how many dependencies down it sits.
  const owner = new Map<string, { cause: string; steps: number }>();
  const walking = new Set<string>();
  const ownerOf = (name: string): { cause: string; steps: number } => {
    const known = owner.get(name);
    if (known !== undefined) return known;
    let found = { cause: name, steps: 0 };
    if (!own(name) && !walking.has(name)) {
      walking.add(name);
      let chosen = false;
      for (const dependency of [...pairs.get(name)!.to.takes].filter(grew).sort(byCodeUnit)) {
        const below = ownerOf(dependency);
        if (!chosen || below.steps + 1 < found.steps) {
          found = { cause: below.cause, steps: below.steps + 1 };
          chosen = true;
        }
      }
      walking.delete(name);
    }
    owner.set(name, found);
    return found;
  };

  const carriedBy = new Map<string, string[]>();
  const causes = new Set<string>();
  for (const name of moved) {
    const { cause } = ownerOf(name);
    causes.add(cause);
    if (cause !== name) carriedBy.set(cause, [...(carriedBy.get(cause) ?? []), name]);
  }

  const told: TierCause[] = [...causes].map((name) => {
    const { from, to } = pairs.get(name)!;
    return {
      package: name,
      from: place(from),
      to: place(to),
      linesFrom: from.lines,
      linesTo: to.lines,
      ownFrom: from.own,
      ownTo: to.own,
      added: without(to.takes, from.takes),
      removed: without(from.takes, to.takes),
      carried: (carriedBy.get(name) ?? []).sort(byCodeUnit),
    };
  });
  told.sort((a, b) => b.carried.length - a.carried.length || byCodeUnit(a.package, b.package));
  return { causes: told, carried: told.reduce((sum, cause) => sum + cause.carried.length, 0) };
}
