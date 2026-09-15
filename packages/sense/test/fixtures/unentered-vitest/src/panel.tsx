import { EmptyState } from './empty-state.js';
import { HeavyChart } from './heavy-chart.js';

export function Panel({ points }: { points: readonly number[] }) {
  return points.length === 0 ? <EmptyState /> : <HeavyChart points={points} />;
}
