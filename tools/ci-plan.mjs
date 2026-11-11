/** CI's suite jobs, using the shard counts the CLI already computed. */
export function suitePlan(suite, full, selected) {
  if (selected?.by === 'recorded' && full.by === 'recorded' && selected.wall <= full.wall) {
    return selected.shards <= 1 ? [{ suite, mode: 'selected' }] : selected.matrix.map((shard) => ({ suite, mode: 'selected', shard }));
  }
  return full.shards <= 1
    ? [{ suite, mode: 'whole' }]
    : full.matrix.map((shard) => ({ suite, mode: 'whole', shard }));
}
