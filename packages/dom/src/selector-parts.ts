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
 * The one walk: the index of the last combinator at depth zero, `-1` when there
 * is none, and the bracket depth the string ends at, which is not zero when it
 * stops inside a `[` or a `(`.
 */
function walk(selector: string): { readonly lastBreak: number; readonly depth: number } {
  let depth = 0;
  let lastBreak = -1;

  for (let index = 0; index < selector.length; index += 1) {
    const char = selector[index]!;
    if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    else if (depth === 0 && (char === ' ' || char === '>' || char === '+' || char === '~')) {
      lastBreak = index;
    }
  }

  return { lastBreak, depth };
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
