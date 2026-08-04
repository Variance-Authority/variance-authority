import { bandOf, type DeltaKind } from '../band.js';
import { impactOf } from '../impact.js';
import type { SemanticNode } from '../../format/snapshot.js';
import type { Delta } from './delta.js';

/**
 * Delta production for a single node, or a single matched pair of nodes.
 *
 * Separated from `index.ts` because everything here answers a strictly local
 * question — given two nodes already known to be the same node, which fields
 * moved — and knows nothing about trees, roots, or attribution. The token
 * reasoning lives here rather than with the attributor for the same reason: the
 * evidence that decides whether a property change is collateral of a token edit
 * is the pair of nodes, and nothing further out has it.
 */

export function wholeNode(
  kind: 'node-added' | 'node-removed' | 'node-moved',
  node: SemanticNode,
): Delta {
  return {
    kind,
    band: bandOf(kind),
    path: node.path,
    to: describe(node),
    ...(node.provenance ? { owners: node.provenance.owners } : {}),
    ...(node.provenance?.createdBy ? { createdBy: node.provenance.createdBy } : {}),
  };
}

function describe(node: SemanticNode): string {
  if (node.role !== undefined && node.name !== undefined) return `${node.role} "${node.name}"`;
  if (node.role !== undefined) return node.role;
  if (node.text !== undefined) return `${node.tag} "${node.text}"`;
  return node.tag;
}

export function compareNodes(
  before: SemanticNode,
  after: SemanticNode,
  deltas: Delta[],
  hasLayout: boolean,
): void {
  const owners = after.provenance?.owners;
  const createdBy = after.provenance?.createdBy;
  const base = (kind: DeltaKind) => ({
    kind,
    band: bandOf(kind),
    path: after.path,
    ...(owners ? { owners } : {}),
    ...(createdBy ? { createdBy } : {}),
  });

  if (before.role !== after.role) {
    deltas.push({ ...base('role-changed'), from: before.role, to: after.role });
  }
  if (before.name !== after.name) {
    deltas.push({ ...base('name-changed'), from: before.name, to: after.name });
  }
  if (before.description !== after.description) {
    deltas.push({
      ...base('description-changed'),
      from: before.description,
      to: after.description,
    });
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
  if (before.tokens?.[token] !== after.tokens?.[token]) return token;

  // The named token held — and may never have had a value at all.
  // `var(--ks-card-radius, var(--va-radius-md))` is the ordinary shape of a
  // component token with a system fallback: `styleTokens` names the outer one,
  // because that is what the author wrote, and when it is undefined the value
  // came from the fallback. Comparing the outer name's value then compares
  // `undefined` with `undefined`, concludes the token held, and reports an edit
  // to the radius *scale* as `component:Card` — "Card changed internally", once
  // per consuming component — instead of one token root with counted collateral.
  // That is the product's headline claim failing on the most common
  // design-system shape there is, and it survived because the corpus asserted
  // the root *count*, which is one either way.
  return soleMovedToken(before, after);
}

/**
 * The one token this node resolved through whose value moved, if there is
 * exactly one.
 *
 * The fallback for a chain whose outer name carries no value. Deliberately
 * refuses to answer when two moved: "the named token held and several others
 * changed" is genuinely ambiguous, and picking one would put a confident wrong
 * name in front of a reviewer. Ambiguity falls through to the component root,
 * which is coarser and true.
 */
function soleMovedToken(before: SemanticNode, after: SemanticNode): string | undefined {
  const moved = unionKeys(before.tokens, after.tokens).filter(
    (name) => before.tokens?.[name] !== after.tokens?.[name],
  );

  return moved.length === 1 ? moved[0] : undefined;
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

function sameRect(before: SemanticNode, after: SemanticNode): boolean {
  const a = before.rect;
  const b = after.rect;
  if (a === undefined || b === undefined) return a === b;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
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
