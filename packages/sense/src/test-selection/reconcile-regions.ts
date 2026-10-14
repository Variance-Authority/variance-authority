import { addressKey } from './merge-carry.js';
import type { ExecutionBlock } from './reverse.js';

/** A region as every inventory of one file can name it: by its place and its identity, not its ordinal. */
export type RegionShape = Omit<ExecutionBlock, 'crossings'>;
type Shape = RegionShape;

/**
 * Several inventories of one source text, read at the regions they all hold.
 *
 * A region only some inventories cut lands on the innermost shared source
 * region enclosing it, and on one region spanning the file only when nothing
 * does. That is where a changed line resolves: a shared region is in every
 * inventory and one inventory's regions nest, so every case that ran the line
 * is credited on the region the change will find. The native stitch applies
 * the same rule; this is its reading for indexes already in memory, and for the
 * readings of one file that one run's transforms cut.
 *
 * The blocks it keeps are the base inventory's own objects, so a caller whose
 * regions carry more than a shape finds them again by identity. `whole` makes
 * the one region it cuts itself into the caller's kind.
 */
// TODO: keep each build's own regions and read a case's ordinals against the build that cut them — needs the case journal to name that build.
export function reconcileRegions<Region extends Shape = Shape>(
  inventories: readonly (readonly Region[])[],
  whole: (shape: Shape) => Region = (shape) => shape as Region,
): {
  readonly blocks: readonly Region[];
  readonly lands: readonly (readonly number[])[];
} {
  if (inventories.length === 1) {
    return { blocks: inventories[0]!, lands: [inventories[0]!.map((_, at) => at)] };
  }
  const base = [...inventories].sort(inventoryOrder)[0] ?? [];
  const keyed = inventories.map(regionKeys);
  const held = keyed.map((keys) => new Set(keys));
  const blocks: Region[] = [];
  const at = new Map<string, number>();
  for (const [index, key] of regionKeys(base).entries()) {
    if (held.every((keys) => keys.has(key))) {
      at.set(key, blocks.length);
      blocks.push(base[index]!);
    }
  }
  const shared = blocks.slice();
  let spanning: number | undefined;
  const lands = inventories.map((inventory, which) => inventory.map((block, index) => {
    const found = at.get(keyed[which]![index]!) ?? enclosing(shared, block);
    if (found !== undefined) return found;
    spanning ??= blocks.push(whole(wholeFile(inventories, base[0]))) - 1;
    return spanning;
  }));
  return { blocks, lands };
}

function enclosing(shared: readonly Shape[], block: Shape): number | undefined {
  let best: number | undefined;
  for (const [at, outer] of shared.entries()) {
    if (!outer.source || outer.startLine > block.startLine || block.endLine > outer.endLine) continue;
    const held = best === undefined ? undefined : shared[best]!;
    if (held === undefined || outer.endLine - outer.startLine < held.endLine - held.startLine) best = at;
  }
  return best;
}

/** The one region spanning the file every inventory cut: the module, from its first source line to its last. */
function wholeFile(inventories: readonly (readonly Shape[])[], first: Shape | undefined): Shape {
  const sourced = inventories.flat().filter((block) => block.source);
  const source = sourced.length > 0;
  return {
    kind: 'module',
    name: first?.name ?? '',
    path: first?.path ?? '',
    startLine: source ? Math.min(...sourced.map((block) => block.startLine)) : first?.startLine ?? 0,
    endLine: source ? Math.max(...sourced.map((block) => block.endLine)) : first?.endLine ?? 0,
    source,
  };
}

function regionKey(block: Shape): string {
  return JSON.stringify([block.kind, block.name, block.path, block.startLine, block.endLine, block.source]);
}

/**
 * Each region's key, told apart from the regions of the same shape before it.
 *
 * Two callbacks handed to one call on one line are both `f/find.arg0` at
 * `entry` on that line, and only their place says which is which. Keyed by
 * shape alone, the second is the first: the join keeps one region, and every
 * reading's second callback lands on it. So repeats are numbered in the order
 * the inventory holds them, which is the order the recipe cut them in every
 * reading, as {@link addressKey} numbers repeated addresses.
 */
function regionKeys(inventory: readonly Shape[]): readonly string[] {
  const seen = new Map<string, number>();
  return inventory.map((block) => addressKey(regionKey(block), seen));
}

function inventoryOrder(left: readonly Shape[], right: readonly Shape[]): number {
  if (left.length !== right.length) return left.length - right.length;
  for (const [at, block] of left.entries()) {
    const other = right[at]!;
    const ordered = block.startLine - other.startLine ||
      block.endLine - other.endLine ||
      Number(block.source) - Number(other.source) ||
      codeUnitOrder(block.kind, other.kind) ||
      codeUnitOrder(block.name, other.name) ||
      codeUnitOrder(block.path, other.path);
    if (ordered !== 0) return ordered;
  }
  return 0;
}

function codeUnitOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
