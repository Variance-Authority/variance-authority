import { boundaries as componentBoundaries, UNATTRIBUTED } from '../attribute/boundary.js';
import type { Digest } from '../format/hash.js';
import type { NodePath, SemanticNode, SemanticSnapshot } from '../format/snapshot.js';
import { BANDS, bandOf, type Band } from './band.js';
import { compareTrees, matchTrees, type Delta } from './diff/index.js';
import { cascadeInputs, declaredIn } from './cascade.js';
import { compareHoldings } from './holding-diff.js';
import { sameTree, sliceOf, type PartingSlice } from './slice.js';

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
 * made about inputs somebody actually read (ADR-0002). It is also only nameable
 * when the two readings were taken at one address — see {@link PartingPlace}.
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
  /**
   * What kind of parting this is, decided before which input moved.
   *
   * The triage line. `refactor` and `settled` are pages nobody needs to open,
   * `flake` is a page whose baseline is the problem, and `variation` is the
   * only one where the rungs below are worth reading.
   */
  readonly slice: PartingSlice;

  /** `true` when both render hashes agree. Inputs may still have moved. */
  readonly identical: boolean;

  /** Every delta, unchanged, so a caller need not run the comparison twice. */
  readonly deltas: readonly Delta[];

  /**
   * Boundaries where something moved — an input, an output, or both — in
   * document order.
   *
   * Absent, never `[]`, when no node on either side started a component: a page
   * read with no framework adapter has not been found to agree, it has not been
   * asked (ADR-0002). Present with every boundary at rung `unread` is the next
   * reading up — the components were found and their inputs were not.
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

  /**
   * Inputs that differ: props, then contexts, then hook calls in order, then
   * the inherited properties no declaration at this boundary accounts for.
   */
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
  /**
   * An inherited style value differs, and this boundary declares none of it.
   * An ancestor's cascade decided this; look up.
   */
  | 'inherited'
  /** A `useSyncExternalStore` snapshot differs — the store moved, outside React. */
  | 'external'
  /** An own hook cell differs. **This is the cause.** */
  | 'stateful'
  /** The output moved and something this boundary depends on could not be read. */
  | 'unread'
  /** Every input was read, every input agreed, and the output moved anyway. */
  | 'undetermined'
  /**
   * The same, between two readings taken in different places. Where a component
   * sits is decided by the boxes around it and is handed to it as nothing, so
   * two instances that agreed on every input and landed apart have contradicted
   * nothing. {@link PartingPlace} is how a caller says which it is asking.
   */
  | 'placed'
  /** The boundary exists on one side only. */
  | 'unpaired';

/**
 * Whether two readings were taken at one address.
 *
 * `same` is a subject read twice — across two revisions, or across two moments
 * of one scenario. There, an output that moved with every input holding is the
 * accusation this system is careful about: the reading is not repeatable.
 *
 * `elsewhere` is two instances lifted out of two subjects at one commit, which
 * is `attribute/divergence.ts`' whole shape. The same evidence means something
 * different there: position, and everything a measured box decides downstream of
 * it, is a function of the context an instance was mounted in, not of the props
 * it received. Calling that nondeterminism blames a component for its page.
 */
export type PartingPlace = 'same' | 'elsewhere';

export interface MovedInput {
  readonly kind: 'prop' | 'context' | 'hook' | 'inherited';

  /**
   * Prop name, context display name, hook name (`useState`), or — for
   * `inherited` — the CSS property an ancestor decided.
   */
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
export function partingOf(
  baseline: SemanticSnapshot,
  candidate: SemanticSnapshot,
  place: PartingPlace = 'same',
): Parting {
  const comparison = compareTrees(baseline, candidate);
  const matching = matchTrees(baseline.root, candidate.root);

  const partner = new Map<SemanticNode, SemanticNode>();
  for (const [left, right] of matching.pairs) partner.set(right, left);

  const tree = sameTree(baseline.root, candidate.root);
  const moved = comparison.deltas.length > 0;

  const found = boundariesOf(baseline.root, candidate.root, partner, {
    there: declaredIn(baseline),
    here: declaredIn(candidate),
  });
  if (found === undefined) {
    return {
      slice: sliceOf(tree, undefined, moved, place),
      identical: comparison.identical,
      deltas: comparison.deltas,
    };
  }

  attribute(found, comparison.deltas);

  const boundaries = found
    .filter((entry) => entry.inputs.length > 0 || entry.owned.length > 0)
    .map((draft) => settle(draft, place));

  const origins = boundaries.filter(
    (entry) =>
      entry.rung === 'stateful' ||
      entry.rung === 'external' ||
      entry.rung === 'undetermined' ||
      entry.rung === 'placed',
  );

  return {
    slice: sliceOf(tree, boundaries, moved, place),
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
  declared: { readonly there: ReadonlySet<string>; readonly here: ReadonlySet<string> },
): Draft[] | undefined {
  const mine = boundaryNodes(candidateRoot);
  const theirs = boundaryNodes(baselineRoot);
  if (mine.length === 0 && theirs.length === 0) return undefined;

  const paired = pairBoundaries(mine, theirs, partner);

  return mine.map((node) => {
    const other = paired.get(node);
    const moved = compareHoldings(other?.holding, node.holding);
    const inputs = [
      ...moved.inputs,
      ...cascadeInputs(other, node, declared.there, declared.here),
    ];
    return {
      component: node.provenance?.owners[0]?.name ?? '(anonymous)',
      path: node.path,
      ...(other === undefined ? {} : { basePath: other.path }),
      depth: depthOf(node.path),
      inputs,
      unread: moved.unread,
      paired: other !== undefined,
      owned: [],
    };
  });
}

/**
 * Every node where a component starts, in document order.
 *
 * Read from provenance and not from `holding`, which is the difference between
 * this module working on one collector and working on all of them. A holding is
 * what a *framework adapter* managed to read at a boundary — props values, hook
 * cells — and only `@variance-authority/unit-test` supplies one today. Keying the
 * boundary set on it made every rung unreachable from a browser run, including
 * the two that need no adapter at all: the ancestor cascade, which is read from
 * `styleProvenance`, and the tree comparison, which is read from the owner
 * chains. Those runs got `unread` — "nothing can be said about why" — while
 * holding the evidence to say it.
 *
 * {@link componentBoundaries} is the shared definition, so a boundary here is
 * the same node the component hashes and the wiring band call one. It reports a
 * node once per component that opens there; the nodes are what this needs, and
 * `boundariesOf` names each by its innermost owner exactly as before.
 *
 * A node with a holding and no provenance is still kept. That is an adapter that
 * read the fiber's values but not its owner chain, and dropping its evidence
 * because of a second failure would lose the one rung it can still reach.
 */
function boundaryNodes(root: SemanticNode): readonly SemanticNode[] {
  const found = new Set<SemanticNode>();
  for (const boundary of componentBoundaries(root)) {
    // `(unattributed)` is the bucket for nodes whose owner chain broke, not a
    // component, and `causesBetween` refuses it for the same reason: a boundary
    // reported there would name a component nobody wrote and pool unrelated
    // parts of the page under one name.
    if (boundary.component === UNATTRIBUTED) continue;
    found.add(boundary.node);
  }

  const holders = (node: SemanticNode): void => {
    if (node.holding !== undefined) found.add(node);
    for (const child of node.children) holders(child);
  };
  holders(root);

  return [...found].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
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
function settle(draft: Draft, place: PartingPlace): PartedBoundary {
  const bands = BANDS.filter((band) => draft.owned.some((delta) => bandOf(delta.kind) === band));

  const moved = [
    ...new Set(draft.owned.map((delta) => delta.property).filter((name) => name !== undefined)),
  ].sort();

  return {
    component: draft.component,
    path: draft.path,
    depth: draft.depth,
    rung: rungOf(draft, place),
    inputs: draft.inputs,
    deltas: draft.owned.length,
    bands,
    ...(moved.length > 0 ? { moved } : {}),
  };
}

function rungOf(draft: Draft, place: PartingPlace): PartingRung {
  if (!draft.paired) return 'unpaired';
  if (draft.inputs.some((input) => input.kind === 'prop')) return 'handed';
  if (draft.inputs.some((input) => input.kind === 'context')) return 'provided';
  if (draft.inputs.some((input) => input.kind === 'inherited')) return 'inherited';
  if (draft.inputs.some((input) => input.name === 'useSyncExternalStore')) return 'external';
  if (draft.inputs.length > 0) return 'stateful';
  if (draft.unread) return 'unread';
  return place === 'same' ? 'undetermined' : 'placed';
}


function depthOf(path: NodePath): number {
  return path === '' ? 0 : path.split('/').length;
}

function parentOf(path: NodePath): NodePath | undefined {
  if (path === '') return undefined;
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '' : path.slice(0, cut);
}
