import type { Digest } from '../format/hash.js';
import type { HeldCell, HeldValue, Holding } from '../format/holding.js';
import type { NodePath, SemanticNode, SemanticSnapshot } from '../format/snapshot.js';
import { BANDS, bandOf, type Band } from './band.js';
import { compareTrees, matchTrees, type Delta } from './diff/index.js';

/**
 * Where two readings of one page parted.
 *
 * A diff says a `<div>` rendered a `<p>` on one side and a `<span>` on the
 * other. That is a symptom, and acting on it means reading the component,
 * guessing which branch ran, and guessing why. This says: `Cart`'s `useState` at
 * call 2 held different values, so `Summary` was handed a different `total`, so
 * the tag moved. Same evidence, three rungs up.
 *
 * The rung it can reach is decided by how much of the boundary was readable, and
 * the difference between the top two rungs is the whole point:
 *
 * - **collateral** — a prop or a context this boundary *received* moved, so the
 *   difference arrived from outside and something above it is the cause.
 * - **origin** — every input this boundary received held, and its own retained
 *   state moved. Nothing above it explains this; it is the answer.
 *
 * The mechanism is one rule applied at every boundary: *a component whose
 * inputs agreed and whose output moved decided differently.* Walking the tree
 * for the shallowest boundary where that holds is what turns a page of deltas
 * into one sentence — and the same rule, run over two readings of one page
 * rather than two arms of an experiment, is what separates a flake from a
 * change. A flake is the case where nothing readable moved at all
 * ({@link PartingRung} `undetermined`), and it is only nameable because
 * `unread` is a rung of its own: an accusation of nondeterminism may only be
 * made about inputs somebody actually read (ADR-0002).
 *
 * Not `attribute/composition.ts`'s `Divergence`, which is the same suspicion
 * arrived at from the other side: one component rendering two ways from one
 * props digest *within* a run, found by counting sites. That one can say a
 * component's inputs do not determine its output; this one can say which input.
 *
 * Nothing here reaches a hash. {@link Holding} is evidence carried beside the
 * snapshot, exactly as `styleProvenance` is, and for the reason `wiring.ts`
 * gives: a hook's value is the thing that legitimately differs between two
 * readings of one page, so a band carrying it would be a flake generator wearing
 * a band's name. This module is the reader that value was kept for.
 */
export interface Parting {
  /** `true` when both render hashes agree. Inputs may still have moved. */
  readonly identical: boolean;

  /** Every delta, unchanged, so a caller need not run the comparison twice. */
  readonly deltas: readonly Delta[];

  /**
   * Boundaries where something moved — an input, an output, or both — in
   * document order.
   *
   * Absent, never `[]`, when no node on either side carried a readable holding:
   * a page with no framework adapter attached has not been found to agree, it
   * has not been asked (ADR-0002).
   */
  readonly boundaries?: readonly PartedBoundary[];

  /**
   * The boundaries the difference started at, shallowest first.
   *
   * A subset of {@link boundaries}: those whose output moved without an
   * incoming input to explain it. Usually one. More than one means the two
   * renders differ in more than one place, which is a real answer rather than a
   * failure to narrow.
   */
  readonly origins?: readonly PartedBoundary[];
}

/**
 * One component boundary, and what moved at it.
 *
 * A boundary is a component's root host node — `componentFiberOf`'s definition,
 * shared with the wiring band so the two can never disagree about where a
 * component starts. A component that vanished entirely has no boundary here: its
 * nodes leave `node-removed` deltas that attribute to the *parent* boundary,
 * which is the correct answer, because deciding not to render a child is
 * something the parent did.
 */
export interface PartedBoundary {
  /** `displayName`, or `(anonymous)` when provenance did not name it. */
  readonly component: string;

  /** Path in the candidate tree. */
  readonly path: NodePath;

  /** Depth of {@link path}, so callers can order without re-parsing it. */
  readonly depth: number;

  readonly rung: PartingRung;

  /** Inputs that differ, props first, then contexts, then hook calls in order. */
  readonly inputs: readonly MovedInput[];

  /**
   * Deltas at or under this boundary that no nested boundary owns.
   *
   * Zero is meaningful and is not a filtered-out row: a boundary with moved
   * inputs and no deltas of its own is the negative result an experiment
   * usually wants — this arm was assigned differently and rendered the same.
   */
  readonly deltas: number;

  /** Bands those deltas fall in, in band order. */
  readonly bands: readonly Band[];

  /**
   * The properties the owned deltas named, deduplicated and in code-unit order.
   *
   * The last joint of the chain the rungs above climb: a hook cell moved, a prop
   * carried it down, and *this* is what the prop turned into on the page —
   * `color`, `padding-top`, `width`. A reader chasing a visual regression is
   * looking for this list, and `deltas: 7` alone sends them back to the delta
   * array to assemble it.
   *
   * Absent when no owned delta named a property, which is a reading rather than
   * a gap: a removed node and a changed accessible name are whole-node facts and
   * have no property to name. `deltas` and `bands` still say what happened
   * there.
   */
  readonly moved?: readonly string[];
}

/**
 * How far up the difference could be traced at one boundary.
 *
 * Ordered by precedence, and the ordering is the reasoning. Any input that
 * arrived from outside settles the question — this boundary is downstream of
 * the cause, whatever else it may also be holding — so `handed` and `provided`
 * outrank the state rungs. `unread` outranks `undetermined` for the same reason
 * pointed the other way: silence is not agreement.
 */
export type PartingRung =
  /** A named prop differs. The parent decided this; look up. */
  | 'handed'
  /** A context value differs. A provider above decided this; look up. */
  | 'provided'
  /** A `useSyncExternalStore` snapshot differs — the store moved, outside React. */
  | 'external'
  /** An own hook cell differs. **This is the cause.** */
  | 'stateful'
  /** The output moved and something this boundary depends on could not be read. */
  | 'unread'
  /** Every input was read, every input agreed, and the output moved anyway. */
  | 'undetermined'
  /** The boundary exists on one side only. */
  | 'unpaired';

export interface MovedInput {
  readonly kind: 'prop' | 'context' | 'hook';

  /** Prop name, context display name, or hook name (`useState`). */
  readonly name: string;

  /** Hook call position — the index a reader gets counting down the component. */
  readonly index?: number;

  /**
   * Explicitly `| undefined`, on {@link Delta}'s rule: an input present on one
   * side only is the reading, not a field somebody forgot.
   */
  readonly from?: Digest | undefined;
  readonly to?: Digest | undefined;
}

/**
 * Two snapshots of the same page, read for where they parted.
 *
 * Takes snapshots rather than trees, and takes them without refusing a subject
 * mismatch, for `compareTrees`' stated reason: this produces an *explanation*,
 * not a verdict, and two arms of an experiment are two subjects on purpose.
 */
export function partingOf(baseline: SemanticSnapshot, candidate: SemanticSnapshot): Parting {
  const comparison = compareTrees(baseline, candidate);
  const matching = matchTrees(baseline.root, candidate.root);

  const partner = new Map<SemanticNode, SemanticNode>();
  for (const [left, right] of matching.pairs) partner.set(right, left);

  const found = boundariesOf(baseline.root, candidate.root, partner);
  if (found === undefined) {
    return { identical: comparison.identical, deltas: comparison.deltas };
  }

  attribute(found, comparison.deltas);

  const boundaries = found
    .filter((entry) => entry.inputs.length > 0 || entry.owned.length > 0)
    .map(settle);

  const origins = boundaries.filter(
    (entry) => entry.rung === 'stateful' || entry.rung === 'external' || entry.rung === 'undetermined',
  );

  return {
    identical: comparison.identical,
    deltas: comparison.deltas,
    boundaries,
    ...(origins.length > 0 ? { origins: [...origins].sort((a, b) => a.depth - b.depth) } : {}),
  };
}

/** A boundary mid-construction, before its deltas are counted. */
interface Draft {
  readonly component: string;
  readonly path: NodePath;
  readonly basePath?: NodePath;
  readonly depth: number;
  readonly inputs: readonly MovedInput[];
  readonly unread: boolean;
  readonly paired: boolean;
  readonly owned: Delta[];
}

/**
 * Every boundary in the candidate tree, in document order, paired with its
 * baseline counterpart.
 *
 * Undefined when neither tree carried a holding at all, which is the ADR-0002
 * distinction this whole module rests on: nothing to read is not nothing to
 * report.
 */
function boundariesOf(
  baselineRoot: SemanticNode,
  candidateRoot: SemanticNode,
  partner: ReadonlyMap<SemanticNode, SemanticNode>,
): Draft[] | undefined {
  const mine = boundaryNodes(candidateRoot);
  const theirs = boundaryNodes(baselineRoot);
  if (mine.length === 0 && theirs.length === 0) return undefined;

  const paired = pairBoundaries(mine, theirs, partner);

  return mine.map((node) => {
    const other = paired.get(node);
    const moved = compareHoldings(other?.holding, node.holding);
    return {
      component: node.provenance?.owners[0]?.name ?? '(anonymous)',
      path: node.path,
      ...(other === undefined ? {} : { basePath: other.path }),
      depth: depthOf(node.path),
      inputs: moved.inputs,
      unread: moved.unread,
      paired: other !== undefined,
      owned: [],
    };
  });
}

function boundaryNodes(root: SemanticNode): readonly SemanticNode[] {
  const found: SemanticNode[] = [];
  const visit = (node: SemanticNode): void => {
    if (node.holding !== undefined) found.push(node);
    for (const child of node.children) visit(child);
  };
  visit(root);
  return found;
}

/**
 * Pair boundaries, preferring the tree matcher and falling back to the owner
 * chain.
 *
 * The fallback is not a nicety, it is the case the whole module exists for. A
 * component that took the other branch returns a `<span>` where it returned a
 * `<p>`, and no host-level matcher pairs those: the tag is the thing that
 * changed, and every identity key ends in it. Reporting the boundary as present
 * on one side only would throw away the props and the hook cells at exactly the
 * moment they are the answer — `Summary` did not appear, it *chose differently*,
 * and the evidence for that is sitting in a holding nobody joined.
 *
 * The chain — the boundary's owner names, outermost component included — is
 * stable under precisely that change, since neither the branch nor the tag
 * appears in it. Ties inside one chain are broken by document order, which is
 * positional and therefore shifts when a sibling is inserted; that is the same
 * cost `match.ts` pays for the same reason, and it is bounded here to
 * components sharing one chain that the matcher already failed to pair.
 */
function pairBoundaries(
  mine: readonly SemanticNode[],
  theirs: readonly SemanticNode[],
  partner: ReadonlyMap<SemanticNode, SemanticNode>,
): ReadonlyMap<SemanticNode, SemanticNode> {
  const paired = new Map<SemanticNode, SemanticNode>();
  const taken = new Set<SemanticNode>();

  for (const node of mine) {
    const other = partner.get(node);
    if (other?.holding === undefined || taken.has(other)) continue;
    paired.set(node, other);
    taken.add(other);
  }

  const spare = new Map<string, SemanticNode[]>();
  for (const node of theirs) {
    if (taken.has(node)) continue;
    const key = chainOf(node);
    const bucket = spare.get(key);
    if (bucket === undefined) spare.set(key, [node]);
    else bucket.push(node);
  }

  for (const node of mine) {
    if (paired.has(node)) continue;
    const bucket = spare.get(chainOf(node));
    const other = bucket?.shift();
    if (other !== undefined) paired.set(node, other);
  }

  return paired;
}

function chainOf(node: SemanticNode): string {
  return (node.provenance?.owners ?? []).map((owner) => owner.name).join('>');
}

/**
 * Give each delta to the deepest boundary that encloses it.
 *
 * By prefix rather than by scanning every boundary: a node's path *is* its
 * ancestry, so walking it up one segment at a time reaches the owning boundary
 * in as many steps as the node is deep. A `node-removed` delta carries a
 * baseline path, so it is resolved in baseline space — mixing the two spaces
 * would silently hand a removal to whichever candidate node now sits at that
 * address, which is the exact misattribution positional diffing is famous for.
 */
function attribute(drafts: readonly Draft[], deltas: readonly Delta[]): void {
  const here = new Map<NodePath, Draft>();
  const there = new Map<NodePath, Draft>();
  for (const draft of drafts) {
    here.set(draft.path, draft);
    if (draft.basePath !== undefined) there.set(draft.basePath, draft);
  }

  for (const delta of deltas) {
    const index = delta.kind === 'node-removed' ? there : here;
    for (let path: NodePath | undefined = delta.path; path !== undefined; path = parentOf(path)) {
      const owner = index.get(path);
      if (owner !== undefined) {
        owner.owned.push(delta);
        break;
      }
    }
  }
}

/** Apply the precedence in {@link PartingRung} and freeze the row. */
function settle(draft: Draft): PartedBoundary {
  const bands = BANDS.filter((band) => draft.owned.some((delta) => bandOf(delta.kind) === band));

  const moved = [
    ...new Set(draft.owned.map((delta) => delta.property).filter((name) => name !== undefined)),
  ].sort();

  return {
    component: draft.component,
    path: draft.path,
    depth: draft.depth,
    rung: rungOf(draft),
    inputs: draft.inputs,
    deltas: draft.owned.length,
    bands,
    ...(moved.length > 0 ? { moved } : {}),
  };
}

function rungOf(draft: Draft): PartingRung {
  if (!draft.paired) return 'unpaired';
  if (draft.inputs.some((input) => input.kind === 'prop')) return 'handed';
  if (draft.inputs.some((input) => input.kind === 'context')) return 'provided';
  if (draft.inputs.some((input) => input.name === 'useSyncExternalStore')) return 'external';
  if (draft.inputs.length > 0) return 'stateful';
  return draft.unread ? 'unread' : 'undetermined';
}

/**
 * What differs between two readings of one boundary.
 *
 * `unread` is returned beside the inputs rather than folded into them because
 * the two answer different questions. The inputs say what moved; `unread` says
 * whether "nothing moved" is a reading or a shrug, and only the second caller —
 * the one about to call a render nondeterministic — needs it.
 */
function compareHoldings(
  left: Holding | undefined,
  right: Holding | undefined,
): { inputs: readonly MovedInput[]; unread: boolean } {
  const inputs: MovedInput[] = [];
  let unread = left?.unread !== undefined || right?.unread !== undefined;

  // Absent props mean `memoizedProps` was not an object, which is a failure to
  // read rather than a component with no props. Symmetric absence is left alone:
  // two readings that failed the same way have not disagreed.
  if ((left?.props === undefined) !== (right?.props === undefined)) unread = true;
  else compareNamed('prop', left?.props, right?.props, inputs);

  // Contexts are different: absent means `dependencies` was null, and that is a
  // positive reading — this component subscribes to no context.
  compareNamed('context', left?.contexts, right?.contexts, inputs);

  if (left?.cells === undefined || right?.cells === undefined) unread = true;
  else compareCells(left.cells, right.cells, inputs);

  return { inputs, unread };
}

function compareNamed(
  kind: 'prop' | 'context',
  left: readonly HeldValue[] | undefined,
  right: readonly HeldValue[] | undefined,
  into: MovedInput[],
): void {
  const before = new Map((left ?? []).map((value) => [value.name, value.digest]));
  const after = new Map((right ?? []).map((value) => [value.name, value.digest]));

  for (const name of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const from = before.get(name);
    const to = after.get(name);
    if (from !== to) into.push({ kind, name, from, to });
  }
}

/**
 * Hook cells, joined on call position.
 *
 * On position rather than on name because position is what a hook *is* to React
 * — the rule the linter enforces — and because a component that ran a different
 * number of hooks took a different branch before it rendered anything. That case
 * arrives here as cells present on one side only, which is a reading rather than
 * a join failure, and one of the loudest available.
 */
function compareCells(
  left: readonly HeldCell[],
  right: readonly HeldCell[],
  into: MovedInput[],
): void {
  const before = new Map(left.map((cell) => [cell.index, cell]));
  const after = new Map(right.map((cell) => [cell.index, cell]));

  for (const index of [...new Set([...before.keys(), ...after.keys()])].sort((a, b) => a - b)) {
    const from = before.get(index);
    const to = after.get(index);
    if (from?.digest === to?.digest && from?.hook === to?.hook) continue;
    into.push({
      kind: 'hook',
      name: to?.hook ?? from?.hook ?? '(unknown)',
      index,
      from: from?.digest,
      to: to?.digest,
    });
  }
}

function depthOf(path: NodePath): number {
  return path === '' ? 0 : path.split('/').length;
}

function parentOf(path: NodePath): NodePath | undefined {
  if (path === '') return undefined;
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '' : path.slice(0, cut);
}
