/**
 * A selector, cut at its last top-level combinator.
 *
 * One scan asked from both ends: `lastCompound` returns what a rule demands of
 * the node itself, `ancestorPortion` what it demands of everything above it.
 * They live together because they are the same walk over the same string —
 * combinators found at depth zero, brackets and parentheses skipped — and a
 * change to how that walk works has to land in both or the two answers stop
 * being complementary halves of one selector.
 *
 * They live apart from their callers because both halves of the pruning need
 * them: the index derives a bucket key from the last compound, and the matcher
 * asks for the ancestor portion to decide whether a non-matching rule is a
 * latent coupling. Neither function touches a DOM, so neither can be wrong about
 * whether a selector *matches* — only about where the string breaks.
 */

/** Everything before the final combinator, or `null` when the selector is simple. */
export function ancestorPortion(selector: string): string | null {
  const { lastBreak } = walk(selector);
  return lastBreak < 0 ? null : selector.slice(0, lastBreak);
}

/** Split off the last compound selector, respecting combinators and nesting. */
export function lastCompound(selector: string): string {
  return selector.slice(walk(selector).lastBreak + 1).trim();
}

/**
 * A compound with what its arguments and attribute selectors hold taken out:
 * `a:not(.plain)` is `a:not()`, `:where(.docs-content h2)` is `:where()`, and
 * `a[href="#top"]` is `a[]`.
 *
 * What is left is what the compound demands of the node by name. A class inside
 * `:where()` belongs to an ancestor or to an alternative, and a `#` inside an
 * attribute value is text, so neither names the node, and a key read from them
 * files the rule where the node never looks.
 */
export function outsideArguments(compound: string): string {
  let depth = 0;
  let kept = '';

  for (let index = 0; index < compound.length; index += 1) {
    const char = compound[index]!;
    if (char === '\\') {
      const end = escapeEnd(compound, index);
      if (depth === 0) kept += compound.slice(index, end);
      index = end - 1;
      continue;
    }
    if (char === ')' || char === ']') depth -= 1;
    if (depth === 0) kept += char;
    if (char === '(' || char === '[') depth += 1;
  }

  return kept;
}

/**
 * The one walk: the index of the last combinator at depth zero, `-1` when there
 * is none, and the bracket depth the string ends at, which is not zero when it
 * stops inside a `[` or a `(`.
 *
 * An escaped character is a character of a name, never structure: `.w-\\[10px\\]`
 * is one class, and so is `.\\32 xl\\:p-4`, whose space ends the escape.
 */
function walk(selector: string): { readonly lastBreak: number; readonly depth: number } {
  let depth = 0;
  let lastBreak = -1;

  for (let index = 0; index < selector.length; index += 1) {
    const char = selector[index]!;
    if (char === '\\') index = escapeEnd(selector, index) - 1;
    else if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    else if (depth === 0 && (char === ' ' || char === '>' || char === '+' || char === '~')) {
      lastBreak = index;
    }
  }

  return { lastBreak, depth };
}

/**
 * Where the escape starting at `at` ends. A hex escape is up to six hex digits
 * and the one whitespace that may close it (`\\32 ` is `2`); any other escape is
 * the one character after the backslash.
 */
export function escapeEnd(text: string, at: number): number {
  const hex = /^[0-9a-f]{1,6}[ \t\n]?/i.exec(text.slice(at + 1, at + 8));
  return at + 1 + (hex !== null ? hex[0].length : 1);
}

/** A name with its escapes resolved: `\\32 xl\\:p-4` is `2xl:p-4`. */
export function unescapeName(name: string): string {
  return name.replace(/\\(?:([0-9a-f]{1,6})[ \t\n]?|(.))/gis, (_, hex: string | undefined, char: string | undefined) =>
    hex !== undefined ? codePoint(Number.parseInt(hex, 16)) : char!,
  );
}

/** A hex escape's character; zero, a surrogate or past Unicode is U+FFFD, as CSS reads it. */
function codePoint(value: number): string {
  return value === 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff) ? '\uFFFD' : String.fromCodePoint(value);
}

/** A selector that styles a pseudo-element, cut into the element it hangs from and the pseudo-element. */
export interface PseudoElementSelector {
  /** What the originating element must match. `*` when the selector names only the pseudo-element. */
  readonly host: string;
  /** The pseudo-element, always in its double-colon form: `::before`, never `:before`. */
  readonly pseudo: string;
}

/**
 * The four pseudo-elements CSS 2 wrote with one colon, which a CSSOM may hand
 * back as written. Every other pseudo-element is invalid with one colon, so no
 * engine hands one back that way.
 */
export const LEGACY_PSEUDO_ELEMENTS: ReadonlySet<string> = new Set(['before', 'after', 'first-line', 'first-letter']);

/**
 * Split a trailing pseudo-element off a selector, or `null` when it styles an element.
 *
 * `Element.matches('.badge::before')` is `false` in every engine — a pseudo-element
 * is not an element — so a rule written for one never reached the box it paints.
 * Matching the host and keeping the pseudo-element beside it is what lets the
 * rule be attributed to the box it styles.
 *
 * Only an argument-less pseudo-element at the very end is split. `::part()` and
 * `::slotted()` select elements and match as written; a pseudo-element followed
 * by anything else is left whole, so it matches what it matched before.
 */
export function splitPseudoElement(selector: string): PseudoElementSelector | null {
  const written = selector.trimEnd();
  const found = /(::?)([a-z-][\w-]*)$/i.exec(lastCompound(written));
  if (!found) return null;

  const name = found[2]!.toLowerCase();
  if (found[1] === ':' && !LEGACY_PSEUDO_ELEMENTS.has(name)) return null;

  // The colons must start a pseudo, not end an escape or sit inside brackets:
  // `.a\:before` is a class, and a match that began inside `[` or `(` is not at depth zero.
  const at = written.length - found[0].length;
  if (at > 0 && written[at - 1] === '\\') return null;
  if (walk(written.slice(0, at)).depth !== 0) return null;

  // `.card ::before` is any descendant's box, not the card's: a host that ends on
  // a combinator, or is empty, gets the universal selector it implied.
  const host = written.slice(0, at);
  const implied = host.length === 0 || /[\s>+~]$/.test(host);
  return { host: implied ? `${host}*` : host, pseudo: `::${name}` };
}
