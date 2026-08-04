import { loudestBand, type Band } from '../band.js';
import { aggregateImpact } from '../impact.js';
import type { EnvironmentDelta } from '../../format/environment.js';
import type { OwnerFrame } from '../../format/provenance.js';
import { impactTag, type Delta, type Root, type RootKind } from './delta.js';
import type { Matching } from './match.js';

/**
 * Grouping deltas into explanations — the docket's entire value proposition.
 *
 * Separated from `index.ts` because it is the half of diffing that has nothing
 * to do with observation: it takes deltas that already exist and decides which
 * *one* sentence covers them. The precedence rules, the metric-delta folding and
 * the boundary walk are all in service of the same claim — report the largest
 * explanation once rather than the smallest one many times — and they only make
 * sense read together.
 */

/**
 * Group deltas into explanations (spec §6.2).
 *
 * Precedence is fixed and deliberate: environment, then token, then props, then
 * component. Each level explains more subjects than the one below it, and the
 * docket's value is entirely in reporting the *largest* explanation once rather
 * than the smallest one many times.
 */
export function attribute(
  deltas: readonly Delta[],
  matching: Matching,
  environmentDeltas: readonly EnvironmentDelta[],
): readonly Root[] {
  const groups = new Map<string, { kind: RootKind; label: string; cause?: string; deltas: Delta[] }>();

  const add = (id: string, kind: RootKind, label: string, delta: Delta, cause?: string): void => {
    const existing = groups.get(id);
    if (existing) existing.deltas.push(delta);
    else groups.set(id, { kind, label, deltas: [delta], ...(cause !== undefined ? { cause } : {}) });
  };

  // A changed environment explains everything under it, so it is collapsed to a
  // single root — the one-action re-baselining case of spec §7.3.
  if (environmentDeltas.length > 0) {
    for (const environmentDelta of environmentDeltas) {
      groups.set(`env:${environmentDelta.field}`, {
        kind: 'environment',
        label: `${environmentDelta.field} ${environmentDelta.from} → ${environmentDelta.to}`,
        deltas: [],
      });
    }
  }

  const propsBefore = ownerDigests(matching, 'before');
  const propsAfter = ownerDigests(matching, 'after');

  const classify = (delta: Delta): Group | null => {
    if (delta.token) return { id: `token:${delta.token}`, kind: 'token', label: delta.token };

    const owners = delta.owners;
    if (owners === undefined || owners.length === 0) return null;

    const boundary = changedBoundary(owners, propsBefore, propsAfter);

    if (boundary === null) {
      // Every incoming props digest held, so the change originated inside a
      // component rather than arriving from outside.
      //
      // *Which* component depends on what kind of change it is. A style change
      // belongs to the component the styled node sits in. A node appearing,
      // vanishing, or moving belongs to whoever *decided it is there* — the
      // component whose JSX created the element, not the component the element
      // is. When a filter list reorders, the nodes that moved are `Chip`s
      // enclosed by a `Stack`, and naming either reports the thing that was
      // rearranged instead of the code that rearranged it.
      const owner = owners[0]!;

      // A node that *moved* is the only case where the responsible component is
      // not the one the node belongs to. Ordering is decided by whoever wrote the
      // JSX that placed the element, so a reordered filter list is `TodoFooter`'s
      // change even though every node that moved is a `Chip`.
      //
      // Appearing and disappearing are deliberately *not* treated this way. A
      // component that swaps its own output — `Toggle` rendering a `<div>` where
      // it used to render an `<input>` — produces an added and a removed node
      // whose creator is `Toggle` itself, and crediting whoever placed `<Toggle>`
      // would blame `TodoItem` for a change it did not make.
      //
      // Known cost: when a component element is added or removed wholesale, this
      // names the component that appeared rather than the one that decided to
      // render it. Distinguishing those needs to know whether the component still
      // exists on the other side, which is a question about the change set rather
      // than about the delta.
      const name = (delta.kind === 'node-moved' ? owner.createdBy : undefined) ?? owner.name;

      return { id: `component:${name}`, kind: 'component', label: name, cause: name };
    }

    // Props moved at a boundary, so the change arrived from outside. The root is
    // the provider — the component that passes props across that boundary.
    const changed = owners[boundary]!;
    const provider = owners[boundary + 1];
    return {
      id: `prop:${provider?.name ?? '?'}>${changed.name}`,
      kind: 'prop',
      label: provider ? `${provider.name} → ${changed.name}` : changed.name,
      // The *provider*, not the component the delta landed in. This is the whole
      // point of a `prop` root: the edit is upstream, and the report has to send
      // a reviewer there.
      //
      // Set **only when a provider exists**. With none, the changed boundary is
      // the outermost frame in the chain: the props arrived from outside the
      // subject entirely, and no component inside it is responsible. Naming the
      // boundary there would send a reviewer to a component whose source is also
      // unchanged, which is the same failure one level out. The fallback in
      // `componentsOf` — the innermost owner, where the change landed — is what
      // both corpora ask for in that case, and the entry's own label still says
      // whose props moved.
      ...(provider !== undefined ? { cause: provider.name } : {}),
    };
  };

  // Metric deltas are held back until every cause has a group, then attached to
  // the nearest one. Without this a profile with layout reports a root per
  // component whose box happened to resize — the change is not lost, but "one
  // root plus counted collateral" becomes "one root per affected component",
  // which is the report spec §6.2 exists to prevent.
  const causes = deltas.filter((delta) => !isMetric(delta)).map((delta) => ({ delta, group: classify(delta) }));

  for (const { delta, group } of causes) {
    if (group === null) add('unattributed', 'unattributed', 'no owner chain', delta);
    else add(group.id, group.kind, group.label, delta, group.cause);
  }

  for (const delta of deltas) {
    if (!isMetric(delta)) continue;

    const target = nearestCause(delta, causes);

    if (target !== undefined) {
      add(target.id, target.kind, target.label, delta, target.cause);
      continue;
    }

    // No cause anywhere: the box moved and nothing explains it. That is a real
    // finding — most often a change outside the subject reaching in — and it
    // keeps its own root rather than being attached to an unrelated one.
    const own = classify(delta);
    if (own === null) add('unattributed', 'unattributed', 'no owner chain', delta);
    else add(own.id, own.kind, own.label, delta, own.cause);
  }

  return [...groups.entries()].map(([id, group]) => ({
    id,
    kind: group.kind,
    label: group.label,
    ...(group.cause !== undefined ? { cause: group.cause } : {}),
    band: dominantBand(group.deltas),
    impact: aggregateImpact(group.deltas.map(impactTag)),
    deltas: group.deltas,
  }));
}

interface Group {
  readonly id: string;
  readonly kind: RootKind;
  readonly label: string;
  /** The component responsible. See `Root.cause`. */
  readonly cause?: string;
}

/**
 * Computed properties that are functions of the used box rather than of any
 * declaration.
 *
 * A layout engine reports these for every element whether or not a stylesheet
 * mentioned them, so they move whenever anything inside or above the node
 * changes size. Treating them as causes is what turned one token edit into five
 * docket entries under `chromium` — `band.ts` already says the attributor must
 * fold rect movement into the style change as collateral, and these are the
 * `style-changed` half of the same evidence.
 *
 * Note the cost of the simplification: a genuine `width: 100px → 200px` edit is
 * folded too, whenever the same node carries another delta to fold into. That
 * loses no delta and moves no verdict — the change is still reported, under a
 * root that is a strictly better description of the cause.
 */
const USED_VALUE_PROPERTIES: ReadonlySet<string> = new Set([
  'width', 'height', 'inline-size', 'block-size',
  'transform-origin', 'perspective-origin',
]);

/** Evidence that a box moved, as opposed to evidence of why. */
function isMetric(delta: Delta): boolean {
  if (delta.kind === 'rect-changed') return true;
  return delta.kind === 'style-changed' && USED_VALUE_PROPERTIES.has(delta.property ?? '');
}

/** Paths are `/`-joined child indices, so containment is a prefix test. */
function isDescendant(candidate: string, ancestor: string): boolean {
  return candidate.startsWith(`${ancestor}/`);
}

/**
 * The cause a metric delta belongs to: same node first, then the nearest change
 * *inside* it, then the nearest change above it.
 *
 * Inside before above, because a box that grew did so because of its contents
 * far more often than because of its container — and when a container really is
 * the cause, its own metric delta folds upward on the same rule, so the two
 * meet at the same root either way.
 */
function nearestCause(
  delta: Delta,
  causes: readonly { readonly delta: Delta; readonly group: Group | null }[],
): Group | undefined {
  const grouped = causes.filter((cause) => cause.group !== null);

  const here = grouped.find((cause) => cause.delta.path === delta.path);
  if (here) return here.group ?? undefined;

  const inside = grouped
    .filter((cause) => isDescendant(cause.delta.path, delta.path))
    .sort((a, b) => a.delta.path.length - b.delta.path.length)[0];
  if (inside) return inside.group ?? undefined;

  const above = grouped
    .filter((cause) => isDescendant(delta.path, cause.delta.path))
    .sort((a, b) => b.delta.path.length - a.delta.path.length)[0];

  return above?.group ?? undefined;
}

/**
 * The outermost owner whose incoming props changed, or `null` if none did.
 *
 * Outermost rather than innermost: if `CheckoutPage` passes a new prop to
 * `Header`, which passes it to `Button`, all three boundaries moved, and the
 * useful root is the one furthest up — reporting `Button` would name the
 * messenger.
 */
function changedBoundary(
  owners: readonly OwnerFrame[],
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): number | null {
  let outermost: number | null = null;

  for (let index = 0; index < owners.length; index += 1) {
    const owner = owners[index]!;
    const digestBefore = before.get(owner.name);
    // An owner absent from the baseline is new structure, not a prop change;
    // the structural delta covers it and inventing a prop root would double-count.
    if (digestBefore === undefined) continue;
    if (digestBefore !== after.get(owner.name)) outermost = index;
  }

  return outermost;
}

function ownerDigests(
  matching: Matching,
  side: 'before' | 'after',
): ReadonlyMap<string, string> {
  const digests = new Map<string, string>();

  for (const [before, after] of matching.pairs) {
    const node = side === 'before' ? before : after;
    for (const owner of node.provenance?.owners ?? []) {
      // First occurrence wins: a component rendered many times with different
      // props is not the same boundary, and this map answers the coarser
      // question of whether *anything* at that boundary moved.
      if (!digests.has(owner.name)) digests.set(owner.name, owner.propsDigest);
    }
  }

  return digests;
}

/**
 * Loudest band present. A group containing one `a11y` delta is an `a11y` root,
 * whatever else moved alongside it.
 *
 * `texture` is the fallback for the empty case rather than a claim: a root is
 * only built from deltas, so the set is never actually empty here.
 */
function dominantBand(deltas: readonly Delta[]): Band {
  return loudestBand(deltas.map((delta) => delta.band)) ?? 'texture';
}
