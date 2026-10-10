import type {
  MatchedRule,
  ObservationProfile,
  Provenance,
  RawNode,
} from '@variance-authority/core/format';
import { admits, declaredValue, matchingParen } from '@variance-authority/core/rules';
import { propertyNames } from './dom-list.js';

/**
 * The boxes CSS generates inside an element: `::before` and `::after`.
 *
 * A generated box paints like a child — it has text, a colour, a background —
 * and the DOM has no node for it, so a walk over child nodes never meets one.
 * `.badge::before { content: "New" }` rewritten to `"Old"` repaints the badge
 * and moved nothing a capture read. These are read here, from the element they
 * hang from, and enter the capture as the children they render as: `::before`
 * first, `::after` last, each with the rules that style it and the text it says
 * as a `#text` child — the same shape an element's
 * text takes, so a reworded box diffs like reworded text.
 *
 * Only these two. `::marker`, `::placeholder` and the rest style a box the
 * capture already holds or one only some elements have; their rules still reach
 * the render document, and none is read as a node.
 */
export const GENERATED_BOXES = ['::before', '::after'] as const;

/**
 * What a generated box under a host without a layout engine could not say.
 *
 * JSDOM implements no generated content: `getComputedStyle(element, '::before')`
 * logs "Not implemented" and answers with the *element's* style. The cascade is
 * still read here: the winning `content` says its words when it is made of
 * strings and `attr()`. A counter, a quote, a `var()` or a `url()` is resolved
 * only by a layout engine or a runtime, so a box whose content holds one is
 * marked with the parts it could not resolve, and says nothing rather than a guess.
 */
export function unreadWords(unresolved: readonly string[]): string {
  return `no layout engine to resolve ${unresolved.join(', ')}: what this generated box says was not read`;
}

/**
 * The generated box `pseudo` adds to `element`, or nothing when it adds none.
 *
 * A box exists when its `content` makes one and its `display` is not `none`.
 * With computed style, the engine answers both. Without it, the declared rules
 * answer, and {@link declaredValue} picks the winner among them by the same
 * order normalization uses for every other property. The box then says the
 * words of the winning `content` when {@link readContent} can read them, or is
 * marked {@link unreadWords} when it cannot.
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
  const saying = (text: string): RawNode[] => (text === '' ? [] : [textNode(text, provenance)]);

  if (!profile.computedStyle || !view) {
    const content = declaredValue(rules, 'content');
    if (!makesBox(content) || declaredValue(rules, 'display') === 'none') return undefined;

    const read = readContent(content, element);
    if ('unresolved' in read) return { ...box, unread: unreadWords(read.unresolved), children: [] };
    return { ...box, children: saying(read.text) };
  }

  const computed = view.getComputedStyle(element, pseudo);
  const content = computed.getPropertyValue('content');
  if (!makesBox(content) || computed.getPropertyValue('display') === 'none') return undefined;

  const read = readContent(content, element);
  return {
    ...box,
    computedStyle: projected(computed),
    // The engine painted what it resolved; a part it reports unresolved is
    // carried as written, so a change to it is still a change.
    children: saying('text' in read ? read.text : content),
  };
}

/** The words a `content` value says, or the parts of it that only an engine or a runtime resolves. */
export type ContentReading = { readonly text: string } | { readonly unresolved: readonly string[] };

/**
 * Read the words a `content` value says on `host`.
 *
 * Strings are unescaped and joined, and `attr(name)` is the host's attribute,
 * or nothing when it has none — which is what an engine paints for both.
 * Alternative text after `/` is for assistive technology and is not painted.
 * Anything else — `counter()`, `open-quote`, `var()`, `url()`, an `attr()` with
 * a type or a fallback — is named in `unresolved`, each once, in order, and
 * so is the rest of a value this reader cannot split into those parts. A
 * string left open runs to the end of the value, as CSS syntax closes it.
 */
export function readContent(content: string, host: Element): ContentReading {
  const words: string[] = [];
  const unresolved: string[] = [];
  const token = /[ \t\n\r\f]*(?:"((?:[^"\\]|\\[\s\S])*)(?:"|$)|'((?:[^'\\]|\\[\s\S])*)(?:'|$)|(\/)|([\w-]+)\(|([^ \t\n\r\f"'(/]+))/y;
  let at = 0;

  while (at < content.length) {
    token.lastIndex = at;
    const found = token.exec(content);
    if (!found) {
      const rest = trimCss(content.slice(at));
      if (rest !== '') unresolved.push(rest);
      break;
    }
    at = token.lastIndex;
    const [, double, single, slash, fn, other] = found;

    if (double !== undefined || single !== undefined) {
      words.push(unescape(double ?? single!));
    } else if (slash !== undefined) {
      break;
    } else if (fn !== undefined) {
      const close = matchingParen(content, at - 1);
      const argument = trimCss(content.slice(at, close));
      at = close + 1;
      const name = fn.toLowerCase();
      if (name === 'attr' && /^[\w-]+$/.test(argument)) words.push(host.getAttribute(argument) ?? '');
      else unresolved.push(`${name}()`);
    } else {
      unresolved.push(other!.toLowerCase());
    }
  }

  return unresolved.length > 0 ? { unresolved: [...new Set(unresolved)] } : { text: words.join('') };
}

/** CSS whitespace is space, tab and the line breaks; a no-break space is not, though `\s` and `trim()` read it as one. */
function trimCss(text: string): string {
  return text.replace(/^[ \t\n\r\f]+|[ \t\n\r\f]+$/g, '');
}

function unescape(string: string): string {
  return string.replace(/\\(?:([0-9a-f]{1,6})[ \t\n]?|(\n)|([\s\S]))/gi, (_, hex, newline, other) => {
    if (hex !== undefined) {
      const code = Number.parseInt(hex, 16);
      const names = code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff);
      return String.fromCodePoint(names ? code : 0xfffd);
    }
    if (newline !== undefined) return '';
    return other as string;
  });
}

/** `none` and `normal` are the two values under which `::before` and `::after` generate nothing. */
function makesBox(content: string | undefined): content is string {
  return content !== undefined && content !== '' && content !== 'none' && content !== 'normal';
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
