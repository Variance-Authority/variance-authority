// compass: variance-authority.reach

/**
 * Run `worker` over every item, at most `limit` at a time, in index order.
 *
 * Index order of *starting*, not of finishing — workers take the next unclaimed
 * item, so a slow item delays nothing behind it. The caller puts results back in
 * order, by the index each worker is handed.
 *
 * A worker that rejects rejects the whole call, so a worker whose items must all
 * finish catches inside itself.
 */
export async function pool<T>(
  limit: number,
  items: readonly T[],
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    for (;;) {
      const index = next++;
      const item = items[index];
      if (item === undefined) return;
      await worker(item, index);
    }
  });

  await Promise.all(lanes);
}
