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

  return lastBreak < 0 ? null : selector.slice(0, lastBreak);
}

/** Split off the last compound selector, respecting combinators and nesting. */
export function lastCompound(selector: string): string {
  let depth = 0;
  let start = 0;

  for (let i = 0; i < selector.length; i += 1) {
    const char = selector[i]!;
    if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    else if (depth === 0 && (char === ' ' || char === '>' || char === '+' || char === '~')) {
      start = i + 1;
    }
  }

  return selector.slice(start).trim();
}
