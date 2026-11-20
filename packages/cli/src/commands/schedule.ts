import type { Config } from '../config.js';

/**
 * How much of a run may happen at once, and the one stage that never may.
 *
 * The whole of the concurrency argument is two small functions, and they are
 * together because they are only meaningful against each other: the raster tier
 * goes as wide as the operator asked for, and collection stays a queue of one
 * however wide that is. Splitting the pair across files is how somebody later
 * widens the half that must not widen.
 *
 * The number behind the shape: painting a subject costs roughly an order of
 * magnitude more than collecting one, so the lane that is allowed to go wide is
 * the one where the time is, and the lane that may not is the cheap one.
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
 * right way round: the raster tier is where the time is, by an order of
 * magnitude.
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
