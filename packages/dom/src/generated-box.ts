import type {
  MatchedRule,
  ObservationProfile,
  Provenance,
  RawNode,
} from '@variance-authority/core/format';
import { admits } from '@variance-authority/core/rules';
import { propertyNames } from './dom-list.js';
import { compareSpecificity } from './specificity.js';

/**
 * The boxes CSS generates inside an element: `::before` and `::after`.
 *
 * A generated box paints like a child — it has text, a colour, a background —
 * and the DOM has no node for it, so a walk over child nodes never meets one.
 * `.badge::before { content: "New" }` rewritten to `"Old"` repaints the badge
 * and moved nothing a capture read. These are read here, from the element they
 * hang from, and enter the capture as the children they render as: `::before`
 * first, `::after` last, each with the rules that style it and, where the engine
 * computes one, the text it says as a `#text` child — the same shape an element's
 * text takes, so a reworded box diffs like reworded text.
 *
 * Only these two. `::marker`, `::placeholder` and the rest style a box the
 * capture already holds or one only some elements have; their rules still reach
 * the render document, and none is read as a node.
 */
export const GENERATED_BOXES = ['::before', '::after'] as const;

/**
 * Why a generated box under a host without a layout engine says nothing.
 *
 * JSDOM implements no generated content: `getComputedStyle(element, '::before')`
 * logs "Not implemented" and answers with the *element's* style. What is known
 * without an engine is which rules style the box and that one of them gives it
 * content; whether it renders, and what it says, is not.
 */
export const GENERATED_BOX_UNREAD =
  'no layout engine: whether this generated box renders, and what it says, were not read';

/**
 * The generated box `pseudo` adds to `element`, or nothing when it adds none.
 *
 * With computed style, the engine decides: a box exists when its `content`
 * makes one and its `display` is not `none`. Without it, the box is reported
 * when the winning declared `content` makes one, carries the rules that style
 * it, and is marked {@link GENERATED_BOX_UNREAD} — never a guessed text or a
 * guessed value.
 */
export function generatedBox(
  element: Element,
  pseudo: (typeof GENERATED_BOXES)[number],
  rules: readonly MatchedRule[],
  profile: ObservationProfile,
  view: Window | null,
  provenance: Provenance | undefined,
): RawNode | undefined {
  const box = {
    tag: pseudo,
    attributes: {},
    matchedRules: [...rules],
    ...(provenance ? { provenance } : {}),
  };

  if (!profile.computedStyle || !view) {
    if (!makesBox(declaredContent(rules))) return undefined;
    return { ...box, unread: GENERATED_BOX_UNREAD, children: [] };
  }

  const computed = view.getComputedStyle(element, pseudo);
  const content = computed.getPropertyValue('content');
  if (!makesBox(content) || computed.getPropertyValue('display') === 'none') return undefined;

  const text = contentText(content);
  return {
    ...box,
    computedStyle: projected(computed),
    children: text === '' ? [] : [textNode(text, provenance)],
  };
}

/**
 * The text a computed `content` says.
 *
 * Strings are unescaped and joined, which is what the engine paints. Anything
 * else — `counter()`, `open-quote`, `url()` — is a value the engine did not
 * resolve to text, and is carried as written: a change to it is still a change,
 * and turning it into prose would be a guess.
 */
export function contentText(content: string): string {
  const strings: string[] = [];
  const pattern = /\s*"((?:[^"\\]|\\[\s\S])*)"\s*/y;
  let at = 0;

  while (at < content.length) {
    pattern.lastIndex = at;
    const found = pattern.exec(content);
    if (!found) return content;
    strings.push(unescape(found[1]!));
    at = pattern.lastIndex;
  }

  return strings.length === 0 ? content : strings.join('');
}

function unescape(string: string): string {
  return string.replace(/\\(?:([0-9a-f]{1,6})[ \t\n]?|(\n)|([\s\S]))/gi, (_, hex, newline, other) => {
    if (hex !== undefined) return String.fromCodePoint(Number.parseInt(hex, 16) || 0xfffd);
    if (newline !== undefined) return '';
    return other as string;
  });
}

/** `none` and `normal` are the two values under which `::before` and `::after` generate nothing. */
function makesBox(content: string | undefined): boolean {
  return content !== undefined && content !== '' && content !== 'none' && content !== 'normal';
}

/** The `content` the cascade picks among declared rules: importance, then specificity, then order. */
function declaredContent(rules: readonly MatchedRule[]): string | undefined {
  let winner: { value: string; important: boolean; rule: MatchedRule } | undefined;

  for (const rule of rules) {
    for (const declaration of rule.declarations) {
      if (declaration.property !== 'content') continue;
      const challenger = { value: declaration.value.trim(), important: declaration.important, rule };
      if (winner === undefined || beats(challenger, winner)) winner = challenger;
    }
  }

  return winner?.value;
}

function beats(
  a: { important: boolean; rule: MatchedRule },
  b: { important: boolean; rule: MatchedRule },
): boolean {
  if (a.important !== b.important) return a.important;
  const specificity = compareSpecificity(a.rule.specificity, b.rule.specificity);
  return specificity === 0 ? a.rule.order > b.rule.order : specificity > 0;
}

/** An element's computed style, projected onto the allowlist. */
export function computedStyleOf(element: Element, view: Window): Record<string, string> {
  return projected(view.getComputedStyle(element));
}

function projected(computed: CSSStyleDeclaration): Record<string, string> {
  const style: Record<string, string> = {};

  for (const property of propertyNames(computed)) {
    // Projection onto the allowlist happens here rather than in `core` only to
    // keep the capture small enough to cross a network hop; `core` re-applies
    // it, so this is a size optimization and never the authoritative filter.
    if (!admits(property)) continue;
    style[property] = computed.getPropertyValue(property);
  }

  return style;
}

/**
 * Text is carried on a synthetic node rather than merged into its parent.
 *
 * `<p>Hello <b>world</b></p>` has two text runs whose order matters. Folding
 * them into the parent's `text` would report a reordering of prose as no change.
 *
 * It carries the parent's owner chain, because that is whose chain it is — React
 * attaches no fiber expando to a text node, but the component that rendered the
 * element rendered its text too. Without this, every text delta lands in
 * `unattributed` and cannot be grouped with the element delta that caused it,
 * which turns one root into several.
 */
export function textNode(text: string, provenance: Provenance | undefined): RawNode {
  return {
    tag: '#text',
    attributes: {},
    matchedRules: [],
    text,
    ...(provenance ? { provenance } : {}),
    children: [],
  };
}
