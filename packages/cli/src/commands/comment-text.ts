/**
 * The two text primitives the docket is written out of, shared by the fold and
 * the render.
 *
 * Separate because both halves need them and neither owns them: `labelOf` builds
 * a cause's label while folding the report, and every block that prints a subject
 * id or a count uses the same two functions. A copy in each file is how the fold
 * and the render start escaping markdown differently, which is a security
 * property here rather than a cosmetic one — see {@link code}.
 */

/**
 * Text as inline code, with a fence long enough to contain it.
 *
 * Component names and landmark phrases carry content from the page under test —
 * `locate` builds a landmark from accessible names, which are whatever the
 * product renders. Interpolating that into markdown unescaped lets a heading, a
 * list marker, or raw HTML from the page rearrange the docket. Inline code
 * neutralises all of it, and the fence is sized to the longest backtick run in
 * the text so that nothing can close it early.
 *
 * Newlines are folded to spaces, because an inline span cannot contain one.
 * Nothing is removed.
 */
export function code(text: string): string {
  const folded = text.replace(/\r?\n/g, ' ');
  const longest = [...folded.matchAll(/`+/g)].reduce(
    (max, match) => Math.max(max, match[0].length),
    0,
  );
  const fence = '`'.repeat(longest + 1);
  const pad = folded.startsWith('`') || folded.endsWith('`') ? ' ' : '';

  return `${fence}${pad}${folded}${pad}${fence}`;
}

/** `1 subject` / `2 subject(s)`, so a count of one does not read as a template. */
export function count(value: number, noun: string): string {
  return value === 1 ? `1 ${noun}` : `${value} ${noun}(s)`;
}
