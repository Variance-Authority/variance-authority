/**
 * CI's suite jobs, using the shard counts the CLI already computed. A recorded
 * selection runs when it fits `budget` (ms) or is no slower than the whole
 * suite: runners are the scarce thing, and a selection holds fewer of them. The
 * whole suite runs only when nothing prices the selection, or when the
 * selection misses the budget and the whole suite is predicted faster.
 */
export function suitePlan(suite, full, selected, budget) {
  const recorded = selected?.by === 'recorded' && full.by === 'recorded';
  const [mode, by] = recorded && (selected.wall <= budget || selected.wall <= full.wall) ? ['selected', selected] : ['whole', full];
  // One job is the shard `1/1`: every job reads the record priced here and records alone.
  return (by.shards >= 1 ? by.matrix : ['1/1']).map((shard) => ({ suite, mode, shard }));
}
