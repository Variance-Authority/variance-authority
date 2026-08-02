import type { Declaration, MatchedRule } from '../../format/capture.js';
import { admits, isCustomProperty } from '../ruleset.js';
import { canonicalizeValue } from './value.js';
import { expandDeclaration } from './shorthand.js';

/**
 * Cascade resolution — ADR-0003 step 5.
 *
 * Losing declarations cannot reach a pixel, so they must not reach a hash. A
 * specificity war that changes *which rule wins* without changing the *winning
 * value* is a refactor, and refactors must not invalidate baselines.
 *
 * Under a profile with computed style the engine has already done this, and its
 * answer is authoritative. This code runs anyway, for two reasons: it supplies
 * the values under `declared-only` profiles, and under both profiles it supplies
 * the attribution side-channel — *which rule set this?* — which computed style
 * cannot answer at all.
 */

/**
 * Properties that inherit.
 *
 * Restricted to the allowlist: inheriting a property the snapshot does not
 * record would cost work and change nothing. Without this, a `color` set once on
 * a container would be invisible on every descendant that renders text under a
 * declared-only profile — the most common styling pattern there is.
 */
export const INHERITED_PROPERTIES: readonly string[] = [
  'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant',
  'font-stretch', 'line-height', 'letter-spacing', 'word-spacing',
  'text-align', 'text-indent', 'text-transform', 'white-space', 'word-break',
  'overflow-wrap', 'visibility', 'direction', 'writing-mode',
  'caption-side', 'border-collapse', 'border-spacing',
];

const INHERITED = new Set(INHERITED_PROPERTIES);

/** Values flowing into a node from its ancestors. */
export interface InheritContext {
  /** Resolved values of inheritable properties. */
  readonly inherited: Readonly<Record<string, string>>;
  /** Custom properties in scope. Every custom property inherits. */
  readonly customProperties: Readonly<Record<string, string>>;

  /**
   * For each inherited property, the token its value came from.
   *
   * Inheritance would otherwise launder away the attribution: a heading that
   * inherits `color` from a container styled with `var(--brand)` produces a
   * delta with no token, no owner chain of its own, and therefore its own
   * `unattributed` root. One token edit would fan out into a docket entry per
   * inheriting text node — destroying precisely the "one root, N collateral"
   * claim the token band exists to make.
   */
  readonly inheritedTokens?: Readonly<Record<string, string>>;
}

export const EMPTY_CONTEXT: InheritContext = { inherited: {}, customProperties: {} };

export interface ResolvedStyle {
  /** Winning, canonicalized values for allowlisted properties. */
  readonly style: Readonly<Record<string, string>>;
  /** Custom properties a winning value resolved through: name → resolved value. */
  readonly tokens: Readonly<Record<string, string>>;
  /** Where each winning declaration came from. Outside the hash by design. */
  readonly origins: Readonly<Record<string, DeclarationOrigin>>;
  /**
   * Which token each property's value came from, including inherited ones.
   *
   * Needed because "this node uses tokens" is not specific enough to attribute a
   * delta: a node may resolve `color` through a token while its `padding` comes
   * from a literal, and only the first is collateral of a token edit.
   */
  readonly propertyTokens: Readonly<Record<string, string>>;
  /** Context to pass to this node's children. */
  readonly childContext: InheritContext;
}

export interface DeclarationOrigin {
  readonly sheet: string;
  readonly selector: string;
  readonly source?: { readonly file: string; readonly line: number };
  readonly tokenName?: string;
}

interface Candidate {
  readonly property: string;
  readonly value: string;
  readonly important: boolean;
  readonly inline: boolean;
  readonly specificity: number;
  readonly order: number;
  readonly sheet: string;
  readonly selector: string;
  readonly source?: { readonly file: string; readonly line: number };
}

export interface ResolveInput {
  readonly matchedRules: readonly MatchedRule[];
  readonly inlineStyle?: Readonly<Record<string, string>>;
  /** Engine-resolved values. When present these win over anything computed here. */
  readonly computedStyle?: Readonly<Record<string, string>>;
  readonly context: InheritContext;
}

export function resolveStyle(input: ResolveInput): ResolvedStyle {
  const candidates = collectCandidates(input);
  const winners = new Map<string, Candidate>();

  for (const candidate of candidates) {
    const incumbent = winners.get(candidate.property);
    if (incumbent === undefined || wins(candidate, incumbent)) {
      winners.set(candidate.property, candidate);
    }
  }

  const customProperties: Record<string, string> = { ...input.context.customProperties };
  for (const [property, candidate] of winners) {
    if (isCustomProperty(property)) customProperties[property] = candidate.value.trim();
  }

  const style: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const origins: Record<string, DeclarationOrigin> = {};

  // Inherited values are the floor: a node that declares nothing still renders
  // with what flowed down to it, and a snapshot omitting that would report two
  // visually different nodes as identical.
  for (const [property, value] of Object.entries(input.context.inherited)) {
    style[property] = value;

    // The token's *own* value, not the property's. Storing the inherited
    // property value here made `tokens` mean two different things depending on
    // whether the node also declared the property: a `<button>` recorded
    // `--va-line-height: 1.4` (correct, from the second loop) while the text
    // node under it recorded `--va-line-height: 19.6px` — the used line-height.
    // The differ reads this map to decide whether a token moved, so a font-size
    // change made an untouched token look like it had moved, and the text node
    // became a second root for a change with one cause. Journal 0006's defect 5
    // in a place its corpus could not reach without a layout engine.
    const token = input.context.inheritedTokens?.[property];
    if (token !== undefined) {
      const resolved = customProperties[token];
      // Falls back to the property value when the token's own value is unknown,
      // which is the whole of a declared-only profile: `:root` is outside the
      // subject, so applicability pruning drops it and no custom property can be
      // resolved. The fallback is a deliberate over-report — a stand-in witness
      // that *something* under this token moved — because an absent entry is
      // indistinguishable from "the token held", and that reads as `unchanged`.
      tokens[token] = resolved === undefined ? value : canonicalizeValue(property, resolved);
    }
  }

  for (const [property, candidate] of winners) {
    if (isCustomProperty(property)) continue;

    const resolution = resolveVariables(candidate.value, customProperties);
    style[property] = canonicalizeValue(property, resolution.value);

    for (const name of resolution.used) {
      const resolved = customProperties[name];
      if (resolved !== undefined) tokens[name] = canonicalizeValue(property, resolved);
    }

    origins[property] = {
      sheet: candidate.sheet,
      selector: candidate.selector,
      ...(candidate.source ? { source: candidate.source } : {}),
      ...(resolution.used[0] !== undefined ? { tokenName: resolution.used[0] } : {}),
    };
  }

  // The engine's own answer supersedes ours wherever it has one. Ours still
  // produced the origins above, which is the half computed style cannot supply.
  if (input.computedStyle) {
    for (const [property, value] of Object.entries(input.computedStyle)) {
      if (!admits(property) || isCustomProperty(property)) continue;
      style[property] = canonicalizeValue(property, value);
    }
  }

  // Which token drives each property, resolved once and reused for both this
  // node's own record and what its children inherit.
  //
  // The precedence matters: a node with its own winning declaration is described
  // by *that* declaration's token, or by no token at all — never by the
  // ancestor's. Falling back to the inherited token when a node declared the
  // property itself makes a rule that *overrode* a token look like collateral of
  // it, which splits one docket root into two.
  const propertyTokens: Record<string, string> = {};
  for (const property of Object.keys(style)) {
    const own = origins[property];
    const token = own !== undefined ? own.tokenName : input.context.inheritedTokens?.[property];
    if (token !== undefined) propertyTokens[property] = token;
  }

  const childInherited: Record<string, string> = {};
  const childInheritedTokens: Record<string, string> = {};

  for (const [property, value] of Object.entries(style)) {
    if (!INHERITED.has(property)) continue;
    childInherited[property] = value;

    // Attribution rides along with the value, so a descendant that merely
    // inherits a token-driven colour is still collateral of that token.
    const token = propertyTokens[property];
    if (token !== undefined) childInheritedTokens[property] = token;
  }

  return {
    style,
    tokens,
    origins,
    propertyTokens,
    childContext: {
      inherited: childInherited,
      customProperties,
      inheritedTokens: childInheritedTokens,
    },
  };
}

function collectCandidates(input: ResolveInput): Candidate[] {
  const candidates: Candidate[] = [];

  for (const rule of input.matchedRules) {
    for (const declaration of rule.declarations) {
      for (const admitted of admitDeclaration(declaration)) {
        candidates.push({
          ...admitted,
          inline: false,
          specificity: specificityRank(rule.specificity),
          order: rule.order,
          sheet: rule.sheet,
          selector: rule.selector,
          ...(rule.source ? { source: rule.source } : {}),
        });
      }
    }
  }

  for (const [property, value] of Object.entries(input.inlineStyle ?? {})) {
    const important = value.trimEnd().toLowerCase().endsWith('!important');
    const bare = important ? value.replace(/!\s*important\s*$/i, '').trim() : value;

    for (const admitted of admitDeclaration({ property, value: bare, important })) {
      candidates.push({
        ...admitted,
        inline: true,
        specificity: 0,
        order: Number.MAX_SAFE_INTEGER,
        sheet: 'inline',
        selector: '[style]',
      });
    }
  }

  return candidates;
}

/**
 * Expand and project one declaration (ADR-0003 step 4).
 *
 * A shorthand that could not be decomposed with confidence is kept under its own
 * name rather than dropped. Dropping it would remove a real value from the hash.
 */
function admitDeclaration(
  declaration: Declaration,
): readonly { property: string; value: string; important: boolean }[] {
  const property = declaration.property.trim().toLowerCase();

  if (isCustomProperty(declaration.property)) {
    // Custom property names are case-sensitive, unlike every other property.
    return [{
      property: declaration.property.trim(),
      value: declaration.value,
      important: declaration.important,
    }];
  }

  const expansion = expandDeclaration(property, declaration.value);

  // An unexpandable shorthand is admitted under its own name. It is not on the
  // allowlist — nothing that decomposes ever is — but dropping it would remove a
  // real declared value from the hash, and a missing value is a false
  // `unchanged`. Under a profile with computed style the engine's longhands
  // arrive separately and supersede it, so this only widens the declared-only tier.
  if (!expansion.confident) {
    return [{ property, value: declaration.value, important: declaration.important }];
  }

  return expansion.declarations
    .filter((entry) => admits(entry.property))
    .map((entry) => ({
      property: entry.property,
      value: entry.value,
      important: declaration.important,
    }));
}

/**
 * The cascade order that matters here: importance, then origin, then
 * specificity, then document order.
 *
 * Author-origin only — user and user-agent stylesheets are the engine's business,
 * and under a profile with computed style the engine's answer overrides this
 * anyway.
 */
function wins(candidate: Candidate, incumbent: Candidate): boolean {
  if (candidate.important !== incumbent.important) return candidate.important;
  if (candidate.inline !== incumbent.inline) return candidate.inline;
  if (candidate.specificity !== incumbent.specificity) {
    return candidate.specificity > incumbent.specificity;
  }
  return candidate.order >= incumbent.order;
}

/**
 * Collapse `[id, class, type]` into one comparable number.
 *
 * The 1 000-per-column base is far above any real selector's count in a column,
 * so this cannot produce the classic "255 classes outrank an id" overflow bug.
 */
function specificityRank(specificity: readonly [number, number, number]): number {
  return specificity[0] * 1_000_000 + specificity[1] * 1_000 + specificity[2];
}

interface VariableResolution {
  readonly value: string;
  /** Custom property names consulted, in order of first appearance. */
  readonly used: readonly string[];
}

/**
 * Substitute `var(--name, fallback)` against the in-scope custom properties.
 *
 * The *names* are recorded alongside the resolved value, and that is the point:
 * a name is what lets one design-token edit collapse into a single docket root
 * with counted collateral, instead of hundreds of unrelated colour diffs
 * (spec §5, `token` band). A resolved value alone cannot be grouped.
 */
export function resolveVariables(
  value: string,
  customProperties: Readonly<Record<string, string>>,
  depth = 0,
): VariableResolution {
  if (!value.includes('var(') || depth > 16) return { value, used: [] };

  const used: string[] = [];
  let result = '';
  let index = 0;

  while (index < value.length) {
    const start = value.indexOf('var(', index);
    if (start < 0) {
      result += value.slice(index);
      break;
    }

    result += value.slice(index, start);

    const end = matchingParen(value, start + 3);
    const inner = value.slice(start + 4, end);
    const comma = topLevelComma(inner);
    const name = (comma < 0 ? inner : inner.slice(0, comma)).trim();
    const fallback = comma < 0 ? undefined : inner.slice(comma + 1).trim();

    if (!used.includes(name)) used.push(name);

    const declared = customProperties[name];
    const substituted = declared ?? fallback ?? '';

    // A custom property may itself reference another. The depth cap is a cycle
    // guard: `--a: var(--b); --b: var(--a)` is invalid CSS the engine drops, and
    // recursing on it would hang the collector rather than report anything.
    const nested = resolveVariables(substituted, customProperties, depth + 1);
    result += nested.value;
    for (const nestedName of nested.used) {
      if (!used.includes(nestedName)) used.push(nestedName);
    }

    index = end + 1;
  }

  return { value: result, used };
}

function matchingParen(input: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < input.length; i += 1) {
    if (input[i] === '(') depth += 1;
    else if (input[i] === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return input.length;
}

function topLevelComma(input: string): number {
  let depth = 0;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if (char === ',' && depth === 0) return i;
  }
  return -1;
}
