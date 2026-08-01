/**
 * Shorthand vs. longhand spelling of identical styling.
 *
 * `margin: 4px` and four `margin-*: 4px` declarations resolve to the same computed
 * value, so they must produce the same hash — otherwise reformatting a stylesheet,
 * or a linter's `--fix`, becomes a repository-wide baseline invalidation. That is
 * why `STYLE_ALLOWLIST` in `core` admits longhands only and expands shorthands
 * before matching.
 *
 * Living in the fixture rather than the component because it is a property of the
 * *variant*, not of the design: no real Card cares how its padding was spelled.
 * Components consult it through context so a fixture can flip it for a whole tree
 * without every component growing a prop nobody would ship.
 *
 * Not all shorthands are safe to test this way, and the corpus deliberately only
 * uses the safe ones. `background: red` also resets `background-image`,
 * `border-radius: 4px 8px` distributes to corners in an order that is easy to get
 * wrong, and `font:` resets six properties including `line-height`. Those are real
 * normalizer hazards, but a fixture that got the equivalence subtly wrong would
 * assert `hash-stable` for two genuinely different renders — a corpus bug that
 * reads as a normalizer bug. See the journal for what that leaves uncovered.
 */

import { createContext, useContext } from 'react';

export type StyleSpelling = 'shorthand' | 'longhand';

export const SpellingContext = createContext<StyleSpelling>('shorthand');

export function useSpelling(): StyleSpelling {
  return useContext(SpellingContext);
}

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

/** `box('padding', spelling, a, b)` → `padding:a b` or the four longhands. */
export function box(
  property: 'padding' | 'margin',
  spelling: StyleSpelling,
  vertical: string,
  horizontal: string,
): string {
  if (spelling === 'shorthand') return `${property}:${vertical} ${horizontal};`;
  const values = [vertical, horizontal, vertical, horizontal];
  return SIDES.map((side, i) => `${property}-${side}:${values[i] ?? vertical};`).join('');
}

/** `border-radius: r` vs. the four corner longhands. */
export function radius(spelling: StyleSpelling, value: string): string {
  if (spelling === 'shorthand') return `border-radius:${value};`;
  return [
    `border-top-left-radius:${value};`,
    `border-top-right-radius:${value};`,
    `border-bottom-right-radius:${value};`,
    `border-bottom-left-radius:${value};`,
  ].join('');
}
