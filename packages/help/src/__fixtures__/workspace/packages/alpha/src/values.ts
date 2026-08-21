/**
 * Measures the thing, and says how much of it there was.
 *
 * The second paragraph, which a list has no room for.
 */
export function measure(width: number): number {
  return width;
}

export class Reading {
  readonly at = 0;
}

/** Two numbers, in order. */
export type Span = readonly [number, number];
