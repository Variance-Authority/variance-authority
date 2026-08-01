import { bandOf, type Band } from '../band.js';
import { aggregateImpact, impactOf, type AggregateImpact, type PropertyImpact } from '../impact.js';
import { diffEnvironments, type EnvironmentDelta } from '../environment.js';
import type { OwnerFrame } from '../provenance.js';
import type { SemanticNode, SemanticSnapshot } from '../snapshot.js';
import { observableBands } from '../profile.js';
import type { ChangedComponent, Delta, Root, RootKind } from './delta.js';
import { matchTrees } from './match.js';

export type { ChangedComponent, Delta, Root, RootKind } from './delta.js';
export { deltaSignature } from './delta.js';
export { matchTrees } from './match.js';
export type { Matching } from './match.js';

export interface SemanticDiff {
  readonly subjectId: string;
  /** `true` when both render hashes agree — nothing below need be consulted. */
  readonly identical: boolean;

  readonly environmentDeltas: readonly EnvironmentDelta[];
  readonly deltas: readonly Delta[];

  /** One entry per explanation. This is what a docket renders and approves. */
  readonly roots: readonly Root[];

  /**
   * Components implicated, separated into causes and collateral.
   *
   * "Eleven components changed" reads like eleven problems. "`Button` changed,
   * and ten components render it" reads like one, which is what it is.
   */
  readonly components: readonly ChangedComponent[];

  /**
   * Whether anything in this change set can move a box.
   *
   * `paint` or `composite` means nothing reflowed and no geometric collateral is
   * possible — a conclusion available without a layout engine, which is how a
   * profile that cannot measure still rules movement out instead of merely
   * failing to observe it.
   */
  readonly impact: AggregateImpact;

  /**
   * Bands this profile could not observe.
   *
   * Reported so that "no geometry deltas" is never mistaken for "geometry is
   * fine" under a profile with no layout engine (ADR-0002).
   */
  readonly unobserved: readonly Band[];
}

/**
 * Compare two snapshots of one subject.
 *
 * @throws {Error} when the snapshots come from different subjects or different
 * observation profiles. Neither is a large diff — they are a category error, and
 * returning deltas for them would let a JSDOM run appear to satisfy a Chromium
 * baseline while blind to every geometry change in it.
 */
export function diffSnapshots(
  baseline: SemanticSnapshot,
  candidate: SemanticSnapshot,
): SemanticDiff {
  if (baseline.subject.id !== candidate.subject.id) {
    throw new Error(
      `refusing to diff different subjects: ${baseline.subject.id} vs ${candidate.subject.id}`,
    );
  }

  if (baseline.profile.id !== candidate.profile.id) {
    throw new Error(
      `refusing to diff across observation profiles: ${baseline.profile.id} vs ${candidate.profile.id}`,
    );
  }

  const bands = observableBands(candidate.profile);
  const unobserved: Band[] = [];
  if (bands.geometry !== 'full') unobserved.push('geometry');
  if (bands.token === 'none') unobserved.push('token');
  if (bands.texture === 'none') unobserved.push('texture');

  const environmentDeltas = diffEnvironments(
    baseline.environment.inputs,
    candidate.environment.inputs,
  );

  if (baseline.renderHash === candidate.renderHash) {
    return {
      subjectId: candidate.subject.id,
      identical: true,
      environmentDeltas,
      deltas: [],
      roots: [],
      components: [],
      impact: 'paint',
      unobserved,
    };
  }

  const matching = matchTrees(baseline.root, candidate.root);
  const deltas: Delta[] = [];

  for (const node of matching.added) {
    deltas.push(wholeNode('node-added', node));
  }
  for (const node of matching.removed) {
    deltas.push(wholeNode('node-removed', node));
  }

  for (const [before, after] of matching.pairs) {
    if (matching.moved.has(before)) {
      deltas.push(wholeNode('node-moved', after));
    }
    compareNodes(before, after, deltas, candidate.profile.layout);
  }

  const roots = attribute(deltas, matching, environmentDeltas);

  return {
    subjectId: candidate.subject.id,
    identical: false,
    environmentDeltas,
    deltas,
    roots,
    components: componentsOf(deltas, roots),
    impact: aggregateImpact(deltas.map(impactTag)),
    unobserved,
  };
}

function impactTag(delta: Delta): PropertyImpact | 'structural' {
  return delta.impact ?? 'structural';
}

function wholeNode(kind: 'node-added' | 'node-removed' | 'node-moved', node: SemanticNode): Delta {
  return {
    kind,
    band: bandOf(kind),
    path: node.path,
    to: describe(node),
    ...(node.provenance ? { owners: node.provenance.owners } : {}),
  };
}

function describe(node: SemanticNode): string {
  if (node.role !== undefined && node.name !== undefined) return `${node.role} "${node.name}"`;
  if (node.role !== undefined) return node.role;
  if (node.text !== undefined) return `${node.tag} "${node.text}"`;
  return node.tag;
}

function compareNodes(
  before: SemanticNode,
  after: SemanticNode,
  deltas: Delta[],
  hasLayout: boolean,
): void {
  const owners = after.provenance?.owners;
  const base = (kind: Parameters<typeof bandOf>[0]) => ({
    kind,
    band: bandOf(kind),
    path: after.path,
    ...(owners ? { owners } : {}),
  });

  if (before.role !== after.role) {
    deltas.push({ ...base('role-changed'), from: before.role, to: after.role });
  }
  if (before.name !== after.name) {
    deltas.push({ ...base('name-changed'), from: before.name, to: after.name });
  }
  if (before.text !== after.text) {
    deltas.push({ ...base('text-changed'), from: before.text, to: after.text });
  }

  for (const property of unionKeys(before.state, after.state)) {
    const from = before.state?.[property];
    const to = after.state?.[property];
    if (from !== to) {
      deltas.push({ ...base('state-changed'), property, from: str(from), to: str(to) });
    }
  }

  for (const property of unionKeys(before.attributes, after.attributes)) {
    const from = before.attributes[property];
    const to = after.attributes[property];
    if (from !== to) {
      deltas.push({ ...base('attribute-changed'), property, from, to });
    }
  }

  let reflowCause: Delta | null = null;

  for (const property of unionKeys(before.style, after.style)) {
    const from = before.style[property];
    const to = after.style[property];
    if (from === to) continue;

    // A token whose own value moved makes this delta collateral rather than a
    // root. Recorded here so attribution does not have to re-derive it.
    const token = changedTokenFor(before, after, property);
    const impact = impactOf(property);

    const delta: Delta = {
      ...base('style-changed'),
      property,
      from,
      to,
      impact,
      ...(token ? { token } : {}),
    };

    deltas.push(delta);
    if (impact === 'layout' && reflowCause === null) reflowCause = delta;
  }

  // Which token a property resolves *through* is part of the render hash, so a
  // change in it moves the hash — but under a profile that cannot resolve custom
  // properties both resolved values are the same empty string and the loop above
  // sees nothing. The result was a non-identical diff carrying zero deltas and
  // zero roots: a correct verdict with an empty docket, which tells a reviewer
  // that something changed and then refuses to say what. Found by scoring
  // `prop-size/button` under `jsdom`, which only became scorable with ADR-0008.
  //
  // Skipped when the resolved value moved too: the `style-changed` delta above
  // already names that property, and reporting both splits one cause in two.
  for (const property of unionKeys(before.styleTokens, after.styleTokens)) {
    const from = before.styleTokens?.[property];
    const to = after.styleTokens?.[property];
    if (from === to) continue;
    if (before.style[property] !== after.style[property]) continue;

    deltas.push({ ...base('token-changed'), property, from, to });
  }

  if (hasLayout && !sameRect(before, after)) {
    // A rect that moved because this node's own padding changed is the same
    // finding observed twice. Folding it under its cause — and inheriting that
    // cause's token — keeps one edit as one docket entry instead of splitting it
    // into a `token` root and an unrelated-looking `geometry` one.
    //
    // A rect that moved with *no* layout-impact change here is different and
    // stays independent: something upstream reflowed and pushed this node, which
    // is exactly the propagation worth surfacing.
    deltas.push({
      ...base('rect-changed'),
      ...(before.rect ? { rectFrom: before.rect } : {}),
      ...(after.rect ? { rectTo: after.rect } : {}),
      ...(reflowCause
        ? {
            derivedFrom: `${reflowCause.path}:${reflowCause.property ?? ''}`,
            ...(reflowCause.token ? { token: reflowCause.token } : {}),
          }
        : {}),
    });
  }
}

/**
 * Which components a change set implicates, and in what capacity.
 *
 * A component is a *root* when a root's own deltas name it innermost — the change
 * originated there. It is *collateral* when it only ever appears further out in
 * an owner chain, or under a token root: it renders something that changed, but
 * nothing about it changed.
 */
function componentsOf(
  deltas: readonly Delta[],
  roots: readonly Root[],
): readonly ChangedComponent[] {
  const rootNames = new Set<string>();
  for (const root of roots) {
    if (root.kind !== 'component' && root.kind !== 'prop') continue;
    for (const delta of root.deltas) {
      const innermost = delta.owners?.[0]?.name;
      if (innermost !== undefined) rootNames.add(innermost);
    }
  }

  const accumulator = new Map<
    string,
    { deltas: number; bands: Set<Band>; impacts: (PropertyImpact | 'structural')[]; within: Set<string> }
  >();

  for (const delta of deltas) {
    const owners = delta.owners ?? [];
    for (const [index, owner] of owners.entries()) {
      let entry = accumulator.get(owner.name);
      if (!entry) {
        entry = { deltas: 0, bands: new Set(), impacts: [], within: new Set() };
        accumulator.set(owner.name, entry);
      }

      // Only the innermost owner is credited with the delta. Every enclosing
      // component would otherwise accumulate every delta beneath it, and a page
      // component would be the biggest change in every diff, every time.
      if (index === 0) {
        entry.deltas += 1;
        entry.bands.add(delta.band);
        entry.impacts.push(impactTag(delta));
      }

      // The chain is innermost-first, so the *next* frame out is what encloses
      // this one. Recording the previous frame instead would answer "what does
      // this component contain?" — which nobody asked, and which reads as an
      // answer to "where does it show up?" until someone checks.
      const enclosing = owners[index + 1];
      if (enclosing) entry.within.add(enclosing.name);
    }
  }

  return [...accumulator.entries()]
    .map(([name, entry]) => ({
      name,
      role: rootNames.has(name) ? ('root' as const) : ('collateral' as const),
      deltaCount: entry.deltas,
      bands: [...entry.bands],
      impact: aggregateImpact(entry.impacts),
      renderedIn: [...entry.within],
    }))
    .sort((a, b) => b.deltaCount - a.deltaCount || a.name.localeCompare(b.name));
}

/**
 * The token that explains *this property's* change, if one does.
 *
 * Two conditions, and both are load-bearing. The property must actually resolve
 * through the token — a node whose `color` comes from a token and whose padding
 * comes from a literal is collateral of a token edit only in its colour. And the
 * token's own value must have moved: a node that merely mentions
 * `--color-primary` while that token held is not collateral of anything, its own
 * rule changed, and it is a root.
 *
 * Dropping either check splits one docket entry into several. Ignoring the
 * property meant a rule that overrode a token-driven value got attributed to the
 * token it had just stopped using.
 */
function changedTokenFor(
  before: SemanticNode,
  after: SemanticNode,
  property: string,
): string | undefined {
  const token = before.styleTokens?.[property];

  // The *same* token must drive the property on both sides. A property that
  // stopped resolving through a token did so because some rule started winning
  // instead — that rule is the root, and blaming the abandoned token would name
  // the thing that did not change.
  // Properties whose initial value is `currentColor` follow `color` without ever
  // naming it: no rule declares `outline-color`, so it resolves through no token,
  // yet a token-driven `color` change moves it. Under a profile with computed
  // style that produced a second root per Button — "the accent token moved" and
  // "Button changed" — for one edit. Recognised by the value matching `color` on
  // both sides, so a node that genuinely declares its own outline colour is
  // unaffected.
  if (token === undefined && FOLLOWS_CURRENT_COLOR.has(property)) {
    const from = before.style[property];
    const to = after.style[property];
    if (from !== undefined && to !== undefined && from === before.style['color'] && to === after.style['color']) {
      return changedTokenFor(before, after, 'color');
    }
    return undefined;
  }

  if (token === undefined || after.styleTokens?.[property] !== token) return undefined;

  // Undefined on one side counts as a change: a theme override introducing a
  // token that previously had no value is exactly the case the token band exists
  // to collapse into one root.
  return before.tokens?.[token] !== after.tokens?.[token] ? token : undefined;
}

function sameRect(before: SemanticNode, after: SemanticNode): boolean {
  const a = before.rect;
  const b = after.rect;
  if (a === undefined || b === undefined) return a === b;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * Group deltas into explanations (spec §6.2).
 *
 * Precedence is fixed and deliberate: environment, then token, then props, then
 * component. Each level explains more subjects than the one below it, and the
 * docket's value is entirely in reporting the *largest* explanation once rather
 * than the smallest one many times.
 */
function attribute(
  deltas: readonly Delta[],
  matching: ReturnType<typeof matchTrees>,
  environmentDeltas: readonly EnvironmentDelta[],
): readonly Root[] {
  const groups = new Map<string, { kind: RootKind; label: string; deltas: Delta[] }>();

  const add = (id: string, kind: RootKind, label: string, delta: Delta): void => {
    const existing = groups.get(id);
    if (existing) existing.deltas.push(delta);
    else groups.set(id, { kind, label, deltas: [delta] });
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
      // Every incoming props digest held, so the change originated inside the
      // innermost component. That component is the root.
      const owner = owners[0]!;
      return { id: `component:${owner.name}`, kind: 'component', label: owner.name };
    }

    // Props moved at a boundary, so the change arrived from outside. The root is
    // the provider — the component that passes props across that boundary.
    const changed = owners[boundary]!;
    const provider = owners[boundary + 1];
    return {
      id: `prop:${provider?.name ?? '?'}>${changed.name}`,
      kind: 'prop',
      label: provider ? `${provider.name} → ${changed.name}` : changed.name,
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
    else add(group.id, group.kind, group.label, delta);
  }

  for (const delta of deltas) {
    if (!isMetric(delta)) continue;

    const target = nearestCause(delta, causes);

    if (target !== undefined) {
      add(target.id, target.kind, target.label, delta);
      continue;
    }

    // No cause anywhere: the box moved and nothing explains it. That is a real
    // finding — most often a change outside the subject reaching in — and it
    // keeps its own root rather than being attached to an unrelated one.
    const own = classify(delta);
    if (own === null) add('unattributed', 'unattributed', 'no owner chain', delta);
    else add(own.id, own.kind, own.label, delta);
  }

  return [...groups.entries()].map(([id, group]) => ({
    id,
    kind: group.kind,
    label: group.label,
    band: dominantBand(group.deltas),
    impact: aggregateImpact(group.deltas.map(impactTag)),
    deltas: group.deltas,
  }));
}

/**
 * Properties whose initial value is `currentColor`.
 *
 * `color` itself is excluded, or the lookup would recurse.
 */
const FOLLOWS_CURRENT_COLOR: ReadonlySet<string> = new Set([
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'outline-color', 'text-decoration-color', 'text-emphasis-color', 'column-rule-color',
  'caret-color',
]);

interface Group {
  readonly id: string;
  readonly kind: RootKind;
  readonly label: string;
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
  matching: ReturnType<typeof matchTrees>,
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

/** Worst band present. A group containing one geometry delta is a geometry root. */
function dominantBand(deltas: readonly Delta[]): Band {
  if (deltas.some((delta) => delta.band === 'geometry')) return 'geometry';
  if (deltas.some((delta) => delta.band === 'token')) return 'token';
  return 'texture';
}

function unionKeys(
  a: Readonly<Record<string, unknown>> | undefined,
  b: Readonly<Record<string, unknown>> | undefined,
): readonly string[] {
  return [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].sort();
}

function str(value: unknown): string | undefined {
  return value === undefined ? undefined : String(value);
}
