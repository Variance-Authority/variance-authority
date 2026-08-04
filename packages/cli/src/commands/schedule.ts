import type { Config } from '../config.js';

/**
 * How much of a run may happen at once, and the one stage that never may.
 *
 * The whole of the concurrency argument is three small functions, and they are
 * together because they are only meaningful against each other: the raster tier
 * goes as wide as the operator asked for, and collection stays a queue of one
 * however wide that is. Splitting the pair across files is how somebody later
 * widens the half that must not widen.
 *
 * The numbers behind the shape: collecting a subject costs ~7.5 ms and painting
 * one ~65 ms, so the lane that is allowed to go wide is the one where the time
 * is, and the lane that may not is the cheap one.
 */

/**
 * A queue of one. Every job runs to completion before the next begins.
 *
 * The collector owns a standing world — one browser, one page, one Storybook for
 * the length of a run (ADR-0009) — so two collections in flight would mount two
 * subjects into one document and let each decide the other's verdict. That is
 * the same hazard the page pool removed from rendering, except here it cannot be
 * removed: the shared world *is* the saving.
 *
 * So collection is serialized and everything downstream is not, which is the
 * right way round: collecting costs ~7.5 ms and the raster tier ~65 ms.
 */
export function serial(): <T>(job: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();

  return <T>(job: () => Promise<T>): Promise<T> => {
    // Chained onto the tail's settlement rather than its value, so one job that
    // rejects does not cancel every job queued behind it.
    const next = tail.then(job, job);
    tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
}

/**
 * Run `worker` over every item, at most `limit` at a time, in index order.
 *
 * Index order of *starting*, not of finishing — workers take the next unclaimed
 * item, so a slow subject delays nothing behind it. The caller is responsible
 * for putting results back in order; here that is `slots`.
 *
 * A worker that rejects rejects the whole call, which is why `observeAll` catches
 * inside the worker instead. Letting one subject's exception abandon the others
 * mid-render would leave pages leased and the report short of subjects it never
 * says it skipped.
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

/**
 * How many subjects may be in the raster tier at once.
 *
 * Defaults to 1, which is what every run did before this existed. Raising it is
 * the operator's call because the cost is theirs: each lane holds a browser page
 * and the decoded pixels of two images, so a 300-subject suite at concurrency 8
 * is a memory decision as much as a speed one.
 */
export function concurrencyOf(config: Config): number {
  return Math.max(1, config.concurrency ?? 1);
}
