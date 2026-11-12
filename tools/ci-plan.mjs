/**
 * CI's suite jobs, using the shard counts the CLI already computed. A recorded
 * selection runs when it fits `budget` (ms) or is no slower than the whole
 * suite: runners are the scarce thing, and a selection holds fewer of them. The
 * whole suite runs only when nothing prices the selection, or when the
 * selection misses the budget and the whole suite is predicted faster.
 */
export function suitePlan(suite, full, selected, budget) {
  const recorded = selected?.by === 'recorded' && full.by === 'recorded';
  if (recorded && (selected.wall <= budget || selected.wall <= full.wall)) {
    // One job is the shard `1/1`, so every selection reads the record priced here.
    return (selected.shards >= 1 ? selected.matrix : ['1/1']).map((shard) => ({ suite, mode: 'selected', shard }));
  }
  return full.shards <= 1
    ? [{ suite, mode: 'whole' }]
    : full.matrix.map((shard) => ({ suite, mode: 'whole', shard }));
}
