import { bandOf, type Band } from '../band.js';
import { diffEnvironments, type EnvironmentDelta } from '../environment.js';
import type { OwnerFrame } from '../provenance.js';
import type { SemanticNode, SemanticSnapshot } from '../snapshot.js';
import { observableBands } from '../profile.js';
import type { Delta, Root, RootKind } from './delta.js';
import { matchTrees } from './match.js';

export type { Delta, Root, RootKind } from './delta.js';
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
    unobserved,
  };
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

  for (const property of unionKeys(before.style, after.style)) {
    const from = before.style[property];
    const to = after.style[property];
    if (from === to) continue;

    // A token whose own value moved makes this delta collateral rather than a
    // root. Recorded here so attribution does not have to re-derive it.
    const token = changedTokenFor(before, after, property);

    deltas.push({
      ...base('style-changed'),
      property,
      from,
      to,
      ...(token ? { token } : {}),
    });
  }

  if (hasLayout && !sameRect(before, after)) {
    deltas.push({
      ...base('rect-changed'),
      ...(before.rect ? { rectFrom: before.rect } : {}),
      ...(after.rect ? { rectTo: after.rect } : {}),
    });
  }
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

  for (const delta of deltas) {
    if (delta.token) {
      add(`token:${delta.token}`, 'token', delta.token, delta);
      continue;
    }

    const owners = delta.owners;
    if (owners === undefined || owners.length === 0) {
      add('unattributed', 'unattributed', 'no owner chain', delta);
      continue;
    }

    const boundary = changedBoundary(owners, propsBefore, propsAfter);

    if (boundary === null) {
      // Every incoming props digest held, so the change originated inside the
      // innermost component. That component is the root.
      const owner = owners[0]!;
      add(`component:${owner.name}`, 'component', owner.name, delta);
      continue;
    }

    // Props moved at a boundary, so the change arrived from outside. The root is
    // the provider — the component that passes props across that boundary.
    const changed = owners[boundary]!;
    const provider = owners[boundary + 1];
    const label = provider ? `${provider.name} → ${changed.name}` : changed.name;
    add(`prop:${provider?.name ?? '?'}>${changed.name}`, 'prop', label, delta);
  }

  return [...groups.entries()].map(([id, group]) => ({
    id,
    kind: group.kind,
    label: group.label,
    band: dominantBand(group.deltas),
    deltas: group.deltas,
  }));
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
