import type { ReactElement } from 'react';

/**
 * The wordmark's glyph: two strokes and the variance path that crosses them.
 *
 * The same four paths the site draws, with the two strokes taken from
 * `currentColor` rather than from ivory — this surface has a second scheme, and a
 * mark that names its own foreground disappears into whichever ground it did not
 * expect. The orange pair is the mark and stays literal.
 */
export function Mark(): ReactElement {
  return (
    <svg className="va-brand" viewBox="0 0 512 320" width="34" height="21" aria-hidden="true">
      <path fill="currentColor" d="M64 54H159L256 266H160Z" />
      <path fill="currentColor" d="M331 28H419L494 266H397Z" />
      <path fill="#ff4a19" d="M256 266L202 152L283 28H376L301 165Z" />
      <path fill="#d83a13" d="M202 152L256 266L301 165L264 103Z" />
    </svg>
  );
}
