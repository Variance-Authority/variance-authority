import type { RawNode } from '../../format/capture.js';
import type { SemanticNode } from '../../format/snapshot.js';

/**
 * Whether a node exists only to hold its children.
 *
 * Conservative on purpose: this is the one normalization rule that *removes* a
 * node, so a wrong answer here deletes evidence. Anything carrying a role, a
 * name, an id, an admitted attribute, text, or a non-inherited style declaration
 * is kept, whatever it looks like.
 *
 * Inherited properties are excluded from the test because a wrapper inheriting
 * `color` from above passes that same value to its children either way — its
 * presence changes nothing that renders.
 */
export function isInertWrapper(
  raw: RawNode,
  node: SemanticNode,
  declaredBy: WeakMap<SemanticNode, ReadonlySet<string>>,
): boolean {
  if (node.tag !== 'div' && node.tag !== 'span') return false;
  if (node.role !== undefined || node.name !== undefined || node.state !== undefined) return false;
  if (node.alias !== undefined || node.text !== undefined) return false;
  if (Object.keys(node.attributes).length > 0) return false;
  if (raw.shadowChildren !== undefined && raw.shadowChildren.length > 0) return false;

  // A wrapper the operator excluded is never inert, whatever it declares.
  //
  // The mark is not an attribute — `data-variance-ignore` is deliberately outside
  // the allowlist so that adding it re-baselines nothing — so the check above
  // cannot see it, and a bare marked `<div>` is exactly the shape this function
  // deletes. Collapsing it drops the mark with it, `sitesIn` finds no site, and
  // the exclusion silently evaporates: the operator reads their config, sees the
  // rule, and the run compares the region anyway. An ignore that stops working
  // without saying so is the same failure as one that absorbs too much, pointed
  // the other way.
  if (node.ignoredBy !== undefined && node.ignoredBy.length > 0) return false;

  // A wrapper that roots a component boundary is never inert either, and for the
  // same reason one sentence up: the collapse would take the holding with it, and
  // `function Summary() { return <span>{total}</span> }` is not an exotic shape —
  // it is most of a component library. Losing the boundary there loses the only
  // record of what that component was handed and what it retained, which is the
  // evidence `compare/parting.ts` traces a difference back through.
  //
  // The cost is stated rather than hidden: a run that reads holdings keeps
  // wrappers a run without them collapses, so the two produce different
  // `structureHash`es for one page. That is why holding is opted into per run
  // rather than defaulted on, and why both sides of a comparison must be read
  // the same way — the same bargain `ignoredBy` makes above.
  //
  // FIXME: `wiring` is destroyed by this collapse and is not checked here. It is
  // hashed into a band, so adding it would move an existing baseline for anyone
  // already reading wiring, which is a change that needs its own changeset.
  if (node.holding !== undefined) return false;

  const declaredHere = declaredBy.get(node) ?? EMPTY_PROPERTIES;

  for (const [property, value] of Object.entries(node.style)) {
    // Only what the wrapper *declared* is evidence about the wrapper.
    //
    // An inherited value passes through unchanged — the children receive it
    // whether or not the wrapper is there. An engine-computed value is worse
    // than uninformative: under a profile with computed style every one of the
    // ~200 allowlisted properties arrives with a resolved value, including used
    // values like `width: 1264px` that describe the *parent's* layout rather
    // than anything the wrapper did. Testing those against an initial-value
    // table meant `isInertDeclaration` returned false on the first unrecognized
    // one and no wrapper anywhere collapsed under `chromium` — the same rule
    // disabled by a different accident under `jsdom` in journal 0005, and
    // invisible until the two profiles were scored against each other (P4).
    //
    // Conservatism is kept where it is evidence: an unrecognized property the
    // wrapper *declared* still blocks the collapse.
    if (!declaredHere.has(property)) continue;
    if (!isInertDeclaration(property, value)) return false;
  }

  return true;
}

const EMPTY_PROPERTIES: ReadonlySet<string> = new Set();

/**
 * Initial values for the properties a bare `div`/`span` legitimately carries.
 *
 * Needed because a profile with computed style reports *every* property, initial
 * ones included — so "declares no styling" cannot be tested by an empty map.
 */
const INERT_VALUES: Readonly<Record<string, readonly string[]>> = {
  // `contents` generates no box at all, so a wrapper carrying it is inert by
  // definition: its children already participate in the parent's layout.
  display: ['block', 'inline', 'contents'],
  position: ['static'],
  'box-sizing': ['content-box', 'border-box'],
  'overflow-x': ['visible'],
  'overflow-y': ['visible'],
  opacity: ['1'],
  visibility: ['visible'],
  transform: ['none'],
  filter: ['none'],
  'backdrop-filter': ['none'],
  'mix-blend-mode': ['normal'],
  'background-color': ['rgb(0 0 0 / 0)'],
  'background-image': ['none'],
  'z-index': ['auto'],
  float: ['none'],
  clear: ['none'],
  width: ['auto'],
  height: ['auto'],
  'min-width': ['0', 'auto'],
  'min-height': ['0', 'auto'],
  'max-width': ['none'],
  'max-height': ['none'],
  'aspect-ratio': ['auto'],
  'content-visibility': ['visible'],
  'object-fit': ['fill'],
  'table-layout': ['auto'],
};

const ZERO_PREFIXED = ['margin-', 'padding-', 'border-', 'outline-', 'inset', 'top', 'right', 'bottom', 'left'];

function isInertDeclaration(property: string, value: string): boolean {
  const allowed = INERT_VALUES[property];
  if (allowed) return allowed.includes(value);

  if (property.startsWith('border-') && property.endsWith('-style')) return value === 'none';
  if (property.startsWith('border-') && property.endsWith('-color')) return true;
  if (property === 'outline-style') return value === 'none';
  if (property === 'outline-color') return true;
  if (property === 'box-shadow' || property === 'text-shadow') return value === 'none';

  if (ZERO_PREFIXED.some((prefix) => property.startsWith(prefix))) {
    return value === '0' || value === 'auto';
  }

  // An unrecognized property on a wrapper is a reason to keep it. Silence is
  // not evidence of inertness.
  return false;
}
