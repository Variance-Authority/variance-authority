import type { Config } from '../config.js';
import type { Collector } from './collector.js';
import type { ObserveContext, Outcome } from './run-context.js';
import { concurrencyOf, serial } from './schedule.js';

/**
 * Workers inside one shard, and how they share the work.
 *
 * A worker is a lane: its own standing world, from the collector's
 * `openWorker`, and its own queue of one in front of it — ADR-0009 holds per
 * world, so each lane collects one subject at a time and switches in place.
 * What is shared is the queue of file groups. A lane that finishes takes the
 * next group, so a lane that drew a short file takes more of them and nobody
 * waits on a lane that drew a long one: stealing, by a shared head rather than
 * by raiding another lane's tail, because the queue is ordered longest first
 * and the tail is where the short work already is.
 *
 * A group is never split across lanes. Its subjects load one module graph, and
 * two worlds loading it is the cost `--shard` refused to pay across machines.
 */

export interface Lane {
  readonly collector: Collector;
  readonly collecting: <T>(job: () => Promise<T>) => Promise<T>;
}

/** `workers`, defaulting to one. */
export function workersOf(config: Config): number {
  return Math.max(1, config.workers ?? 1);
}

/**
 * The run's own collector as the first lane, and `workers - 1` more from it.
 *
 * A collector with no `openWorker` runs one lane and the warning says so: the
 * operator asked for a width, and silence would read as having it.
 */
export async function openLanes(
  collector: Collector,
  workers: number,
): Promise<{ readonly lanes: readonly Lane[]; readonly warnings: readonly string[] }> {
  const lanes: Lane[] = [{ collector, collecting: serial() }];
  if (workers <= 1) return { lanes, warnings: [] };

  if (collector.openWorker === undefined) {
    return {
      lanes,
      warnings: [
        `\`workers\` is ${workers}, and this collector supplies no \`openWorker\`, so the ` +
          'run collected in one world',
      ],
    };
  }

  const openWorker = collector.openWorker.bind(collector);
  try {
    for (let k = 1; k < workers; k++) lanes.push({ collector: await openWorker(), collecting: serial() });
  } catch (error) {
    await closeLanes(lanes);
    throw error;
  }
  return { lanes, warnings: [] };
}

/** Every lane but the first; the run's own collector is closed where it always was. */
export async function closeLanes(lanes: readonly Lane[]): Promise<void> {
  await Promise.all(lanes.slice(1).map(async (lane) => lane.collector.close()));
}

/** The context a lane's subjects are decided in: second readings stay in its world. */
export function contextFor(context: ObserveContext, lane: Lane): ObserveContext {
  if (lane.collector === context.deps.collector) return context;
  return { ...context, deps: { ...context.deps, collector: lane.collector } };
}

/**
 * Run `body` over every index in `queue`, group by group, lane by lane.
 *
 * Each lane keeps up to `window` subjects in flight — `concurrency` shared
 * across the lanes, so the raster tier is exactly as wide as it was configured
 * — and takes its next group only once it has started the last subject of the
 * one before. With one lane and a concurrency of one this is the loop a run
 * always was: one subject at a time, in queue order.
 */
export async function steal(
  lanes: readonly Lane[],
  queue: readonly (readonly number[])[],
  config: Config,
  body: (index: number, lane: Lane) => Promise<void>,
): Promise<void> {
  const window = Math.max(1, Math.ceil(concurrencyOf(config) / lanes.length));
  let next = 0;

  await Promise.all(
    lanes.map(async (lane) => {
      const running = new Set<Promise<void>>();
      for (;;) {
        const group = queue[next++];
        if (group === undefined) break;
        for (const index of group) {
          while (running.size >= window) await Promise.race(running);
          const job: Promise<void> = body(index, lane).finally(() => running.delete(job));
          running.add(job);
        }
      }
      await Promise.all(running);
    }),
  );
}

/**
 * The outcome with its `costMs`: first collection to decision, on the injected
 * clock. No clock, or no start, is no cost — never a zero, which would price
 * the subject as free and stack the next run's long files on one shard.
 *
 * The declaring file rides with the cost, because the file is what a shard
 * places; a cost without it can price a subject and not the group it sits in.
 */
export function timed(
  outcome: Outcome,
  started: number | undefined,
  elapsed: (() => number) | undefined,
  declaredIn?: string,
): Outcome {
  if (outcome.kind !== 'observed' || started === undefined || elapsed === undefined) return outcome;
  const record = { ...outcome.record, costMs: elapsed() - started };
  return { ...outcome, record: declaredIn === undefined ? record : { ...record, declaredIn } };
}
