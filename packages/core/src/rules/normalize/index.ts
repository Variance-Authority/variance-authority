import type { Diagnostic, RawCapture, RawNode } from '../../format/capture.js';
import { environmentKey } from '../../format/environment.js';
import { digestCombine, digestValue, type Digest } from '../../format/hash.js';
import { ALLOWLIST_VERSION, RULESET_VERSION, admitsAttribute } from '../ruleset.js';
import type { CanonicalValue } from '../../format/canonical.js';
import type { SemanticNode, SemanticSnapshot, StyleProvenanceEntry } from '../../format/snapshot.js';
import { aliasAttributeValue, aliasStyleValue, buildAliasMap, type AliasResult } from './alias.js';
import {
  EMPTY_CONTEXT,
  INHERITED_PROPERTIES,
  resolveStyle,
  type InheritContext,
} from './cascade.js';

export { buildAliasMap, aliasAttributeValue, aliasStyleValue } from './alias.js';
export type { AliasMap, AliasResult } from './alias.js';
export {
  resolveStyle,
  resolveVariables,
  INHERITED_PROPERTIES,
  EMPTY_CONTEXT,
} from './cascade.js';
export type { InheritContext, ResolvedStyle, DeclarationOrigin } from './cascade.js';
export { canonicalizeValue, canonicalizeTokens, canonicalizeDimension, isUnresolved } from './value.js';
export { canonicalizeColor, parseColor, formatColor } from './color.js';
export { expandDeclaration, isShorthand, SHORTHAND_PROPERTIES } from './shorthand.js';

/**
 * The normalization pipeline: `RawCapture` in, `SemanticSnapshot` out.
 *
 * There is exactly one of these, and both observation profiles enter it (ADR-0001).
 * That is what makes "the same rules ran for JSDOM and Chromium" a fact of the
 * call graph rather than a claim maintained by discipline.
 */

export interface NormalizeOptions {
  /**
   * Collapse `div`/`span` wrappers that carry no role, no attributes, and no
   * non-inherited styling. Defaults to on — CSS-in-JS and layout libraries emit
   * these by the dozen, and their arrival and departure during a refactor is the
   * single largest source of structural churn.
   */
  readonly collapseWrappers?: boolean;

  /** Replace text with its digest. For subjects whose copy is volatile by policy. */
  readonly digestText?: boolean;
}

export function normalize(capture: RawCapture, options: NormalizeOptions = {}): SemanticSnapshot {
  const { collapseWrappers = true, digestText = false } = options;

  const portals = capture.portals ?? [];
  const aliases = buildAliasMap(capture.root, portals);
  const diagnostics: Diagnostic[] = [...capture.diagnostics];

  for (const id of aliases.dangling) {
    diagnostics.push({
      severity: 'warn',
      code: 'dangling-id-reference',
      // Reported rather than normalized away: an accessible-name reference
      // pointing outside the subject is either a genuine break or a subject
      // boundary drawn too tightly. Both need a human.
      message: `reference to id "${id}" resolves outside the subject subtree`,
    });
  }

  // Custom properties go into the resolution scope, never into `inherited`.
  //
  // The seed arrives with both mixed together, and injecting the whole thing as
  // inherited style put every ancestor-declared token into the subject root's
  // `style` map as if it were a rendered value. Two consequences, both bad: a
  // token nothing in the subject consumes still changed that subject's hash — so
  // editing any token invalidated every baseline in the repository — and the
  // resulting delta had no owner chain, producing an `unattributed` root on a
  // change that was perfectly well understood.
  const seed: InheritContext = {
    inherited: renderableOnly(capture.inheritedSeed),
    customProperties: customPropertiesOf(capture.inheritedSeed),
  };

  const styleProvenance: StyleProvenanceEntry[] = [];
  const state: WalkState = {
    collapseWrappers,
    digestText,
    styleProvenance,
    declaredBy: new WeakMap(),
  };
  const container = normalizeNode(capture, capture.root, aliases, seed, '0', state);

  // Portalled subtrees are appended as children of the subject root, each
  // flagged `portalled`. Appending rather than splicing in place keeps their
  // paths stable when DOM children are added or removed, and keeps them out of
  // the wrapper-collapse pass, which reasons about siblings.
  const root: SemanticNode =
    portals.length === 0
      ? container
      : {
          ...container,
          children: [
            ...container.children,
            ...portals.map((portal, index) => ({
              ...normalizeNode(
                capture,
                portal,
                aliases,
                { inherited: {}, customProperties: seed.customProperties },
                `0/portal:${index}`,
                state,
              ),
              portalled: true as const,
            })),
          ],
        };

  const structureHash = digestValue(structureOf(root));
  const styleHash = digestValue(styleOf(root, capture.profile.layout));

  const environment = environmentKey({
    ...capture.environment,
    ruleset: RULESET_VERSION,
    allowlist: ALLOWLIST_VERSION,
  });

  return {
    formatVersion: 1,
    subject: capture.subject,
    profile: capture.profile,
    environment,
    // Keyed on the *semantic* digest, not the full one. A snapshot is a semantic
    // artifact, so binding it to inputs that only rasterization can observe would
    // split one baseline across machines that render it identically.
    renderHash: digestCombine('render', [environment.semanticDigest, structureHash, styleHash]),
    structureHash,
    styleHash,
    root,
    styleProvenance,
    diagnostics,
  };
}

interface WalkState {
  readonly collapseWrappers: boolean;
  readonly digestText: boolean;
  readonly styleProvenance: StyleProvenanceEntry[];
  /**
   * Properties each node declared *itself*, as opposed to inheriting.
   *
   * The wrapper-inertness test needs this distinction and cannot recover it from
   * the finished node: by then an inherited `color` and a declared `color` are
   * the same entry in `style`. Keyed by node identity rather than threaded
   * through the return type, so the recursive shape stays a plain tree walk.
   */
  readonly declaredBy: WeakMap<SemanticNode, ReadonlySet<string>>;
}

function normalizeNode(
  capture: RawCapture,
  subtreeRoot: RawNode,
  aliases: AliasResult,
  context: InheritContext,
  path: string,
  state: WalkState,
): SemanticNode {
  return build(subtreeRoot, context, path);

  function build(node: RawNode, inherited: InheritContext, nodePath: string): SemanticNode {
    const resolved = resolveStyle({
      matchedRules: node.matchedRules,
      ...(node.inlineStyle ? { inlineStyle: node.inlineStyle } : {}),
      ...(node.computedStyle ? { computedStyle: node.computedStyle } : {}),
      context: inherited,
    });

    const style: Record<string, string> = {};
    for (const [property, value] of Object.entries(resolved.style)) {
      style[property] = aliasStyleValue(aliases, value);
    }

    for (const [property, origin] of Object.entries(resolved.origins)) {
      state.styleProvenance.push({
        path: nodePath,
        property,
        sheet: origin.sheet,
        selector: normalizeSelector(origin.selector),
        ...(origin.tokenName ? { tokenName: origin.tokenName } : {}),
        ...(origin.source ? { source: origin.source } : {}),
      });
    }

    const attributes: Record<string, string> = {};
    for (const [name, value] of Object.entries(node.attributes)) {
      if (!admitsAttribute(name)) continue;
      attributes[name] = aliasAttributeValue(aliases, name, value);
    }

    const rawId = node.attributes['id'];
    const alias = rawId !== undefined ? aliases.local.get(rawId) : undefined;

    const children = collectChildren(node, resolved.childContext, nodePath);
    const declaredHere = new Set(Object.keys(resolved.origins));

    const text =
      node.text === undefined
        ? undefined
        : state.digestText
          ? digestValue(node.text)
          : normalizeText(node.text);

    const built: SemanticNode = {
      path: nodePath,
      tag: node.tag.toLowerCase(),
      ...(alias !== undefined ? { alias } : {}),
      ...(node.aria?.role ? { role: node.aria.role } : {}),
      ...(node.aria?.name ? { name: node.aria.name } : {}),
      ...(node.aria?.description ? { description: node.aria.description } : {}),
      ...(node.aria && Object.keys(node.aria.state).length > 0 ? { state: node.aria.state } : {}),
      attributes,
      style,
      ...(Object.keys(resolved.tokens).length > 0 ? { tokens: resolved.tokens } : {}),
      ...(Object.keys(resolved.propertyTokens).length > 0
        ? { styleTokens: resolved.propertyTokens }
        : {}),
      ...(capture.profile.layout && node.rect ? { rect: node.rect } : {}),
      ...(text !== undefined ? { text } : {}),
      ...(node.provenance ? { provenance: node.provenance } : {}),
      children,
    };

    state.declaredBy.set(built, declaredHere);
    return built;
  }

  function collectChildren(
    node: RawNode,
    childContext: InheritContext,
    nodePath: string,
  ): readonly SemanticNode[] {
    const source = [...node.children, ...(node.shadowChildren ?? [])];
    const built: SemanticNode[] = [];

    for (const child of source) {
      const candidate = build(child, childContext, `${nodePath}/${built.length}`);

      // A collapsed wrapper is replaced by its children in place. Re-pathing them
      // is why collapse must happen during the walk rather than as a later pass:
      // paths must reflect the final tree, or every downstream reference is stale.
      if (state.collapseWrappers && isInertWrapper(child, candidate, state)) {
        for (const grandchild of candidate.children) {
          built.push(repath(grandchild, `${nodePath}/${built.length}`));
        }
        continue;
      }

      built.push(candidate);
    }

    return built;
  }
}

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
function isInertWrapper(raw: RawNode, node: SemanticNode, state: WalkState): boolean {
  if (node.tag !== 'div' && node.tag !== 'span') return false;
  if (node.role !== undefined || node.name !== undefined || node.state !== undefined) return false;
  if (node.alias !== undefined || node.text !== undefined) return false;
  if (Object.keys(node.attributes).length > 0) return false;
  if (raw.shadowChildren !== undefined && raw.shadowChildren.length > 0) return false;

  const declaredHere = state.declaredBy.get(node) ?? EMPTY_PROPERTIES;

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
const INHERITED = new Set(INHERITED_PROPERTIES);

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

function repath(node: SemanticNode, path: string): SemanticNode {
  return {
    ...node,
    path,
    children: node.children.map((child, index) => repath(child, `${path}/${index}`)),
  };
}

/**
 * Structure alone: shape, roles, names, descriptions, states, admitted
 * attributes, text.
 *
 * Hashed separately from style so the docket can say *which* held. "The DOM is
 * identical, only styling moved" is the sentence that turns a diff into a
 * token-band root instead of a structural review.
 */
function structureOf(node: SemanticNode): CanonicalValue {
  return {
    tag: node.tag,
    alias: node.alias,
    portalled: node.portalled,
    role: node.role,
    name: node.name,
    description: node.description,
    state: node.state as CanonicalValue | undefined,
    attributes: node.attributes,
    text: node.text,
    children: node.children.map(structureOf),
  };
}

function styleOf(node: SemanticNode, includeLayout: boolean): CanonicalValue {
  const entries: CanonicalValue[] = [];

  const visit = (current: SemanticNode): void => {
    entries.push({
      path: current.path,
      style: current.style,
      tokens: current.tokens,
      // Absent, never zeroed, under a profile without layout (ADR-0002).
      rect: includeLayout && current.rect ? { ...current.rect } : undefined,
    });
    for (const child of current.children) visit(child);
  };

  visit(node);
  return entries;
}

/**
 * Collapse runs of whitespace to a single space, without trimming.
 *
 * Collapsing matches what `white-space: normal` does, so indentation depth is
 * not a hash input. Trimming does not: a *boundary* space between inline
 * elements is rendered, and removing it changes "a b" to "ab". Since the
 * formatting context is unknowable without layout, the space is kept —
 * over-reporting in a block context, rather than reporting a visible text change
 * as `unchanged`.
 *
 * This costs little in practice because subjects are React-rendered, and JSX
 * already strips whitespace-only lines and newline-adjacent indentation at
 * compile time. Hand-written HTML pays more.
 */
function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ');
}

/**
 * Replace generated segments in selector text with a placeholder.
 *
 * Selectors reach the snapshot only through the attribution side-channel, which
 * is outside the hash — but a selector naming `css-1a2b3c` is still useless in a
 * docket, because the name changes whenever any declaration in its file changes.
 * The placeholder keeps the shape, which is what identifies the rule to a reader.
 */
function normalizeSelector(selector: string): string {
  return selector
    .replace(/\.(?:css|sc|emotion)-[a-z0-9]{4,}/gi, '.«generated»')
    .replace(/\.[\w-]*__[a-z0-9]{5,}\b/gi, '.«generated»')
    .replace(/\[data-(?:styled|emotion|v)-[^\]]*\]/gi, '[«generated»]')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The seed minus its custom properties: values that actually render. */
function renderableOnly(seed: Readonly<Record<string, string>>): Record<string, string> {
  const renderable: Record<string, string> = {};
  for (const [property, value] of Object.entries(seed)) {
    if (!property.startsWith('--')) renderable[property] = value;
  }
  return renderable;
}

function customPropertiesOf(seed: Readonly<Record<string, string>>): Record<string, string> {
  const custom: Record<string, string> = {};
  for (const [property, value] of Object.entries(seed)) {
    if (property.startsWith('--')) custom[property] = value;
  }
  return custom;
}

export type { Digest };
