import type { SemanticNode } from '../format/snapshot.js';
import type { Wiring } from '../format/wiring.js';
import type { PartedBoundary, PartingPlace } from './parting.js';

/**
 * What kind of parting this is, before anything about which one.
 *
 * The rungs in `parting.ts` answer *which input moved*. This answers the
 * question asked first and answered least: **is this worth looking at at all.**
 * Three facts are read independently — did the component tree move, did any
 * input move, did the output move — and the eight combinations collapse to
 * seven sentences, five of which are a triage decision on their own:
 *
 * | component tree | inputs | output | slice |
 * |---|---|---|---|
 * | same | same | **moved** | `flake` |
 * | any | **moved** | **moved** | `variation` |
 * | **moved** | same | **moved** | `reshaped` |
 * | **moved** | any | same | `refactor` |
 * | same | **moved** | same | `absorbed` |
 * | same | same | same | `settled` |
 * | unread | — | **moved** | `unread` |
 *
 * A fourth fact splits the first row, and it is not about the page: *were the
 * two readings taken in the same place*. Where a thing sits is decided by the
 * boxes around it, and no component receives its own position as a prop — so
 * two instances that agreed on every input and landed at different coordinates
 * have not contradicted anything. That row is `placed`. `flake` keeps the case
 * it was named for: one subject, read twice, answering differently.
 *
 * `reshaped` is the row that used to be missing. It was answered `variation`,
 * whose sentence says an input moved — and the whole point of this table is
 * that in that row no input did. Two readings whose component trees are not the
 * same tree, reached from inputs that all agreed, is a component that chose a
 * different shape: a branch taken differently between two arms, or a rewrite
 * between two revisions. Either way the tree is the finding and the rungs below
 * have nothing to add, because there is no moved input for them to name.
 *
 * `refactor` is the one that pays for the other six. A component tree that
 * moved while the page did not is the receipt a refactor never gets: the
 * screenshots match, which is what a pixel differ says and all it says, and
 * *the components underneath were rewritten*, which is the fact somebody wanted
 * confirmed before merging.
 */
export type PartingSlice =
  /** Nothing moved: not the tree, not an input, not the output. */
  | 'settled'
  /** An input moved and the output followed. The ordinary parting. */
  | 'variation'
  /** Every input agreed, the tree held, and the output moved anyway. */
  | 'flake'
  /** The same, in two places. Context decided it, and context is not a prop. */
  | 'placed'
  /** The component tree is a different tree, no input moved, and the output followed. */
  | 'reshaped'
  /** The component tree moved and the output did not. */
  | 'refactor'
  /** An input moved and the output did not: the component ignored it. */
  | 'absorbed'
  /** The output moved and what would explain it was not read. */
  | 'unread';

/**
 * Decide the slice from three independent readings.
 *
 * `place` says whether the two readings were taken at one address. It only ever
 * decides between `flake` and `placed`, and it defaults to `same` because that
 * is what every comparison across revisions is.
 *
 * `tree` is `undefined` when neither side carried provenance — not `false`.
 * A run that never asked what components were there has not found them equal,
 * and both `refactor` and `flake` are claims about the component tree that such
 * a run is not entitled to make (ADR-0002).
 */
export function sliceOf(
  tree: boolean | undefined,
  boundaries: readonly PartedBoundary[] | undefined,
  moved: boolean,
  place: PartingPlace = 'same',
): PartingSlice {
  // Nothing was read, so nothing may be alleged. `flake` in particular is an
  // accusation, and it is the one this project must never make on silence.
  if (boundaries === undefined) return moved ? 'unread' : 'settled';

  const inputs = boundaries.some((boundary) => boundary.inputs.length > 0);

  if (!moved) {
    if (tree === false) return 'refactor';
    return inputs ? 'absorbed' : 'settled';
  }

  if (inputs) return 'variation';
  if (tree === false) return 'reshaped';
  // `flake` is the accusation, and it rests on the component tree having held.
  // A run that read holdings but no provenance never established that, so it
  // gets the rung that says so rather than the one that blames the page.
  if (tree === undefined) return 'unread';
  return place === 'same' ? 'flake' : 'placed';
}

/**
 * Whether the two component trees are the same tree.
 *
 * The signature is the owner chain plus the wiring at each node that carries
 * one, in document order — the shape `wiringOf` already records, which is what
 * makes this a reading of the fiber rather than of the markup it produced. A
 * renamed component, an added `memo`, a hook inserted, a `key` changed and a
 * subtree moved all land here; a repainted pixel does not.
 *
 * `undefined` when neither side carried provenance at any node. A page read
 * without a framework adapter has no component tree to compare, which is a
 * different answer from two trees that matched.
 */
export function sameTree(baseline: SemanticNode, candidate: SemanticNode): boolean | undefined {
  const left = signature(baseline, []);
  const right = signature(candidate, []);
  if (left.length === 0 && right.length === 0) return undefined;
  if (left.length !== right.length) return false;
  return left.every((entry, index) => entry === right[index]);
}

function signature(node: SemanticNode, out: string[]): string[] {
  const owners = node.provenance?.owners;
  if (owners !== undefined && owners.length > 0) {
    out.push(`${owners.map((owner) => owner.name).join('>')}|${wiringKey(node.wiring)}`);
  }
  for (const child of node.children) signature(child, out);
  return out;
}

/**
 * Wiring as one comparable string.
 *
 * Field order is fixed here rather than taken from `Object.keys`, so that a
 * wiring gaining a field it did not have changes the key for a reason a reader
 * can name, and never because the two objects were built in a different order.
 */
function wiringKey(wiring: Wiring | undefined): string {
  if (wiring === undefined) return '';
  return [
    wiring.hooks?.join(',') ?? '',
    wiring.wrappers?.join(',') ?? '',
    wiring.contexts?.join(',') ?? '',
    wiring.key ?? '',
  ].join(';');
}
