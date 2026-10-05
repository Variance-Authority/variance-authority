/**
 * Which packages changed dependency layer between two code maps, told as the
 * few moves that caused it and the count each one carried along.
 *
 * A package that moves layer moves the layer of everything above it. Listing
 * all of them would print one edit five hundred times, so a mover is one of two
 * things: a **cause**, whose own dependencies changed and whose layer moved
 * with them, or **carried**, whose dependencies are exactly what they were and
 * which moved only because something below it did. Each carried package is
 * counted under one cause, found by following the dependency that moved it
 * down to a cause, so the counts add up to the total.
 *
 * A package whose own dependencies changed and whose layer did not is **held**.
 * Between causes and held packages, every dependency a package started or
 * stopped taking is told once, whether or not a layer moved.
 *
 * It performs no I/O: it compares two lists a code map kept.
 */

// compass: variance-authority.reach.relations

import type { NativeOrientPackageLayer as PackageLayer } from './native-orient.js';

/** One package whose own dependencies changed and whose layer moved with them. */
export interface LayerCause {
  readonly package: string;
  readonly from: number;
  readonly to: number;
  /** Packages it started importing, in code-unit order. */
  readonly added: readonly string[];
  /** Packages it stopped importing, in code-unit order. */
  readonly removed: readonly string[];
  /** Packages that moved only because of this one, in code-unit order. */
  readonly carried: readonly string[];
}

/** One package whose own dependencies changed and whose layer did not. */
export interface LayerHeld {
  readonly package: string;
  readonly layer: number;
  /** Packages it started importing, in code-unit order. */
  readonly added: readonly string[];
  /** Packages it stopped importing, in code-unit order. */
  readonly removed: readonly string[];
}

/** The layer moves between two code maps: the causes with what each carried, and the packages that only appeared or vanished. */
export interface LayerMoves {
  /** Largest cascade first, then the largest move, then name. */
  readonly causes: readonly LayerCause[];
  /** Movers whose dependencies did not change: the sum of every cause's `carried`. */
  readonly carried: number;
  /** Packages in both maps whose dependencies changed and whose layer held, in code-unit order. */
  readonly held: readonly LayerHeld[];
  /** In the head map and not the base: they have no earlier layer to move from. */
  readonly appeared: readonly string[];
  /** In the base map and not the head. */
  readonly vanished: readonly string[];
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function without(names: readonly string[], others: readonly string[]): string[] {
  const held = new Set(others);
  return names.filter((name) => !held.has(name));
}

/** Compare two maps' package layers; each list is one map's `packages`. */
export function layerMoves(base: readonly PackageLayer[], head: readonly PackageLayer[]): LayerMoves {
  const before = new Map(base.map((entry) => [entry.package, entry]));
  const after = new Map(head.map((entry) => [entry.package, entry]));
  const appeared = head.filter((entry) => !before.has(entry.package)).map((entry) => entry.package).sort(byCodeUnit);
  const vanished = base.filter((entry) => !after.has(entry.package)).map((entry) => entry.package).sort(byCodeUnit);

  const moved = new Map<string, { from: PackageLayer; to: PackageLayer }>();
  const held: LayerHeld[] = [];
  for (const to of head) {
    const from = before.get(to.package);
    if (from === undefined) continue;
    if (from.layer !== to.layer) moved.set(to.package, { from, to });
    else {
      const added = without(to.takes, from.takes);
      const removed = without(from.takes, to.takes);
      if (added.length > 0 || removed.length > 0) held.push({ package: to.package, layer: to.layer, added, removed });
    }
  }
  held.sort((a, b) => byCodeUnit(a.package, b.package));

  const changed = (name: string): boolean => {
    const { from, to } = moved.get(name)!;
    return without(to.takes, from.takes).length > 0 || without(from.takes, to.takes).length > 0;
  };

  // The movers a mover takes whose move is the one that moved it: for a rise,
  // the ones now sitting just below it; for a fall, the ones that sat just below it.
  const movers = (name: string): readonly string[] => {
    const { from, to } = moved.get(name)!;
    const rose = to.layer > from.layer;
    const moving = to.takes.filter((dependency) => moved.has(dependency));
    const near = moving.filter((dependency) => {
      const seen = moved.get(dependency)!;
      return (rose ? seen.to.layer : seen.from.layer) === (rose ? to.layer : from.layer) - 1;
    });
    return (near.length > 0 ? near : moving).sort(byCodeUnit);
  };

  // Each mover's cause and how many dependencies down it sits from it.
  const owner = new Map<string, { cause: string; steps: number }>();
  const walking = new Set<string>();
  const ownerOf = (name: string): { cause: string; steps: number } => {
    const known = owner.get(name);
    if (known !== undefined) return known;
    let found: { cause: string; steps: number } = { cause: name, steps: 0 };
    if (!changed(name) && !walking.has(name)) {
      walking.add(name);
      let chosen = false;
      for (const dependency of movers(name)) {
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
  for (const name of moved.keys()) {
    const { cause } = ownerOf(name);
    if (cause !== name) carriedBy.set(cause, [...(carriedBy.get(cause) ?? []), name]);
  }

  const causes: LayerCause[] = [];
  for (const [name, { from, to }] of moved) {
    if (ownerOf(name).cause !== name) continue;
    causes.push({
      package: name,
      from: from.layer,
      to: to.layer,
      added: without(to.takes, from.takes),
      removed: without(from.takes, to.takes),
      carried: (carriedBy.get(name) ?? []).sort(byCodeUnit),
    });
  }
  causes.sort(
    (a, b) =>
      b.carried.length - a.carried.length ||
      Math.abs(b.to - b.from) - Math.abs(a.to - a.from) ||
      byCodeUnit(a.package, b.package),
  );
  return { causes, carried: causes.reduce((sum, cause) => sum + cause.carried.length, 0), held, appeared, vanished };
}
