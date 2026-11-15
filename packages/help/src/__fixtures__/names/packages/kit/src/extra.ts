/** Walks a tree, one level at a time. */
export function walk(depth: number): number {
  /** One level of the walk. */
  function step(at: number): number {
    return at <= 0 ? 0 : 1 + step(at - 1);
  }
  return step(depth);
}
