import type { Adjacency, NodeId, Relations } from '@variance-authority/core/relate';
import { nodeAt } from '@variance-authority/core/relate';

/**
 * What an import costs to walk, counted in hops.
 *
 * The closure is not ranked and will not be: a file is in a scope or it is not,
 * and nothing here bounds a walk or drops a file for being far away. What this
 * adds is a second number beside each file — how expensive the cheapest way in
 * to it was — because *reachable* is one bit and a reader looking at four
 * hundred reachable files is not being told anything by it.
 *
 * ## The four moves
 *
 * A hop is classified by where the two files sit relative to each other, never
 * by which way the walk happened to be going. An arrow is one edge and costs one
 * thing, whether it was read along or against.
 *
 * | the import goes | costs |
 * |---|---:|
 * | into its own folder, or deeper | 1 |
 * | sideways, to neither an ancestor nor a descendant | 1.5 |
 * | up, to a folder above it, inside one package | 2 |
 * | out of the package altogether | 4 |
 *
 * Down is cheapest because a file reaching into its own folder is reaching for
 * its own parts. Up is dear because a file reaching above itself is reaching for
 * something shared, and shared is where a neighbourhood stops being one. Out of
 * the package is dearer again for the same reason, one order louder.
 *
 * Sideways is one bucket however far sideways it goes — the cousin in the next
 * folder and the cousin nine folders over cost the same. That is the shape of
 * the rule as it was set, and whether the distance across matters is a thing to
 * measure rather than a thing to assume.
 *
 * ## What it is worth, measured
 *
 * Against a plain hop count — every import costing 1 — the weighted cost puts
 * no two files in a different order. Measured on a 954-file application, from a
 * routing hub reaching 740 files and against a UI-kit leaf reached by 519, the
 * two orders agree on **every** pair, and the rank correlation is 0.99.
 *
 * The reason is the census. Two thirds of that application's imports are
 * sideways and a third are down; *up* is 1.3% of them and *out* is none at all,
 * because a repository that is one package has no out. A path of k edges
 * costing 1 or 1.5 each therefore costs between k and 1.5k, and those bands do
 * not cross often enough to reorder anything. Steepening the schedule to
 * 1/3/6/12 starts to bite — 2.3% of pairs — and 1/1.5/2/4 does not.
 *
 * So as a *ranking* input this is currently plain depth in a costume, and the
 * ratio between the four figures, not the four figures, is the thing that would
 * have to change to make it anything else. It is kept at the stated values
 * because the stated values are what was asked for and what the measurement
 * above is a measurement of.
 *
 * ## It is recorded, not applied
 *
 * Nothing reads these to decide an answer yet. They are a column, kept beside
 * the scope so a ranking can be measured against them before a ranking is
 * changed by them. Separate, too, from **distance** — the hop count between two
 * subjects that `--at-distance` names — which is a different quantity over a
 * different pair of things and is not touched here.
 */

/**
 * The unit, so every cost is a whole number.
 *
 * The figures are 1, 1.5, 2 and 4; a half of one is the unit they are all
 * integers in. Nothing that might one day decide an order is kept as a float
 * here — two machines summing the same halves in different orders agree exactly,
 * and that is the whole reason.
 */
export const PER_HOP = 2;

/** Into its own folder, or deeper: one hop. */
export const DOWN = 1 * PER_HOP;
/** Sideways, to neither an ancestor nor a descendant: one and a half. */
export const SIDEWAYS = 3;
/** Up, to a folder above it, inside one package: two. */
export const UP = 2 * PER_HOP;
/** Out of the package: four. */
export const OUT = 4 * PER_HOP;

/** One move, as the reader would name it. */
export type Hop = 'down' | 'sideways' | 'up' | 'out';

/** What each move costs, in half-hops. */
export const COST: Readonly<Record<Hop, number>> = {
  down: DOWN,
  sideways: SIDEWAYS,
  up: UP,
  out: OUT,
};

/** A cost as the figure the table above prints. */
export function hopsOf(cost: number): string {
  return `${cost / PER_HOP}`;
}

/** The folder a file is in, as segments. A file at the root is in no folder. */
function folderOf(path: string): readonly string[] {
  const segments = path.split('/').filter((segment) => segment !== '');
  return segments.slice(0, -1);
}

/** Whether one folder is the other, or above it. Segment for whole segment. */
function above(higher: readonly string[], lower: readonly string[]): boolean {
  if (higher.length > lower.length) return false;
  for (let segment = 0; segment < higher.length; segment += 1) {
    if (higher[segment] !== lower[segment]) return false;
  }
  return true;
}

/**
 * The package a file belongs to: the longest declared root it is under, or the
 * repository itself when none of them holds it.
 *
 * A root is a directory that a manifest governs, and it is supplied rather than
 * guessed — `packages/` and `apps/` are two repositories' conventions and
 * neither is a fact. The one boundary read off a path is `node_modules`, and
 * only because it is not a convention: `node_modules/x` and
 * `node_modules/@scope/x` are where a package begins by the resolver's own
 * rules, so a dependency's boundary is known without being told.
 */
export function packageOf(path: string, roots: readonly string[]): string {
  const modules = installedRootOf(path);
  if (modules !== undefined) return modules;

  let held = '';
  for (const root of roots) {
    if (root.length > held.length && path.startsWith(root)) held = root;
  }
  return held;
}

/** Where an installed package begins, for a path inside `node_modules`. */
function installedRootOf(path: string): string | undefined {
  const at = path.lastIndexOf('node_modules/');
  if (at === -1) return undefined;
  const after = path.slice(at + 'node_modules/'.length).split('/');
  const named = after[0]?.startsWith('@') ? after.slice(0, 2) : after.slice(0, 1);
  if (named.length === 0 || named[named.length - 1] === undefined) return undefined;
  return `${path.slice(0, at)}node_modules/${named.join('/')}/`;
}

/**
 * What one import costs, read off the two paths.
 *
 * `importer` is the file the arrow leaves and `imported` is the file it arrives
 * at, always, however the walk is travelling. A cost that changed with the
 * direction of reading would make the same edge two different edges.
 */
export function hopBetween(importer: string, imported: string, roots: readonly string[]): Hop {
  if (packageOf(importer, roots) !== packageOf(imported, roots)) return 'out';

  const from = folderOf(importer);
  const to = folderOf(imported);
  if (above(from, to)) return 'down';
  if (above(to, from)) return 'up';
  return 'sideways';
}

/**
 * The cheapest way in to every file reachable from the seeds, in half-hops.
 *
 * Cheapest rather than shortest: the point of weighing the moves is that four
 * cheap ones can be nearer than one expensive one, and a breadth-first answer
 * would say the opposite. Seeds cost nothing.
 *
 * Only file-to-file arrows are walked. The graph carries a node per component
 * as well, and a component is a name rather than a place — two files declaring
 * one component are not a folder apart, they are not anywhere, and letting a
 * walk cross between them would hand back a cost that is not about any import.
 */
export function costsFrom(
  relations: Relations,
  seeds: readonly NodeId[],
  along: Adjacency,
  roots: readonly string[],
  /** `true` when `along` runs against the arrows, so the edge's own ends swap. */
  against = false,
): ReadonlyMap<string, number> {
  const costs = new Map<string, number>();
  const best = new Map<NodeId, number>();
  const queue = new Heap();

  for (const seed of seeds) {
    if (nodeAt(relations, seed)?.kind !== 'file') continue;
    if ((best.get(seed) ?? Infinity) <= 0) continue;
    best.set(seed, 0);
    queue.push(seed, 0);
  }

  while (queue.size > 0) {
    const [id, paid] = queue.pop();
    if (paid > (best.get(id) ?? Infinity)) continue;
    const name = relations.names[id];
    if (name === undefined) continue;
    costs.set(name, paid);

    for (let edge = along.offset[id]!; edge < along.offset[id + 1]!; edge += 1) {
      const next = along.target[edge]! as NodeId;
      if (nodeAt(relations, next)?.kind !== 'file') continue;
      const other = relations.names[next];
      if (other === undefined) continue;
      const step = COST[against ? hopBetween(other, name, roots) : hopBetween(name, other, roots)];
      const total = paid + step;
      if (total >= (best.get(next) ?? Infinity)) continue;
      best.set(next, total);
      queue.push(next, total);
    }
  }

  return costs;
}

/**
 * A binary heap over (node, cost).
 *
 * A queue that pops the cheapest, which is the one thing Dijkstra needs and the
 * one thing an array does not do in less than linear time. Small enough to read
 * in a sitting, and there is no dependency here worth taking for it.
 */
class Heap {
  private readonly ids: NodeId[] = [];
  private readonly costs: number[] = [];

  get size(): number {
    return this.ids.length;
  }

  push(id: NodeId, cost: number): void {
    this.ids.push(id);
    this.costs.push(cost);
    let at = this.ids.length - 1;
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (this.costs[parent]! <= this.costs[at]!) break;
      this.swap(at, parent);
      at = parent;
    }
  }

  pop(): readonly [NodeId, number] {
    const id = this.ids[0]!;
    const cost = this.costs[0]!;
    const lastId = this.ids.pop()!;
    const lastCost = this.costs.pop()!;
    if (this.ids.length > 0) {
      this.ids[0] = lastId;
      this.costs[0] = lastCost;
      let at = 0;
      for (;;) {
        const left = 2 * at + 1;
        const right = left + 1;
        let small = at;
        if (left < this.ids.length && this.costs[left]! < this.costs[small]!) small = left;
        if (right < this.ids.length && this.costs[right]! < this.costs[small]!) small = right;
        if (small === at) break;
        this.swap(at, small);
        at = small;
      }
    }
    return [id, cost];
  }

  private swap(one: number, two: number): void {
    [this.ids[one], this.ids[two]] = [this.ids[two]!, this.ids[one]!];
    [this.costs[one], this.costs[two]] = [this.costs[two]!, this.costs[one]!];
  }
}
