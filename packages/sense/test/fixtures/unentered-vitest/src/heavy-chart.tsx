// The branch that is never taken. Importing this file runs its top level;
// nothing below the top level runs unless somebody renders the component.
export const PALETTE = ['#111', '#eee'];

export function HeavyChart({ points }: { points: readonly number[] }) {
  const total = points.reduce((sum, point) => sum + point, 0);
  return <figure data-total={total}>{points.length} points</figure>;
}
