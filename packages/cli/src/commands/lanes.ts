import { availableParallelism } from 'node:os';
import type { Step } from '@variance-authority/core/format';
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

/**
 * `workers` as declared; undeclared, half the machine's logical cores, at least
 * one — the default Playwright Test takes. Half, because a page read is mostly
 * waiting and the other half is left to what the waiting is for: the run's own
 * comparison and, on one machine, the server under test.
 *
 * A declared `concurrency` holds the derived width: it is a memory bound, and
 * every world holds a page and a subject in flight. A declared width is the
 * operator's word on both and is taken as it is.
 */
export function workersOf(config: Config, cores: number = availableParallelism()): number {
  if (config.workers !== undefined) return Math.max(1, config.workers);
  return Math.max(1, Math.min(Math.floor(cores / 2), config.concurrency ?? Number.POSITIVE_INFINITY));
}

/**
 * The run's own collector as the first lane, and up to `workers - 1` more from
 * it: never more lanes than there are file groups, because a world with nothing
 * to take is a browser opened for nothing.
 *
 * A collector with no `openWorker` runs one lane. When the width was declared
 * the warning says so: the operator asked for it, and silence would read as
 * having it. A derived width is a ceiling, not a request, and says nothing.
 */
export async function openLanes(
  collector: Collector,
  config: Config,
  groups: number,
): Promise<{ readonly lanes: readonly Lane[]; readonly warnings: readonly string[] }> {
  const lanes: Lane[] = [{ collector, collecting: serial() }];
  const workers = Math.min(workersOf(config), groups);
  if (workers <= 1) return { lanes, warnings: [] };

  if (collector.openWorker === undefined) {
    if (config.workers === undefined) return { lanes, warnings: [] };
    return {
      lanes,
      warnings: [
        `\`workers\` is ${config.workers}, and this collector supplies no \`openWorker\`, so the ` +
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

/**
 * The context a lane's subjects are decided in: a second reading stays in its
 * world, and a reading alone is opened by whichever collector can open one.
 *
 * A worker is a standing world and opens nothing alone; the clean world is the
 * run's collector's to build, from the same recipe. Without it a subject's
 * evidence would depend on the world it drew: the same change read alone in
 * one world and "not re-run alone" in another.
 */
export function contextFor(context: ObserveContext, lane: Lane): ObserveContext {
  const own = context.deps.collector;
  const worker = lane.collector;
  if (worker === own) return context;
  const isolated = worker.collectAlone === undefined ? own : worker;
  const collector: Collector = {
    plan: async () => worker.plan(),
    collect: async (planned) => worker.collect(planned),
    ...(worker.callSites !== undefined ? { callSites: worker.callSites } : {}),
    ...(isolated.collectAlone !== undefined ? { collectAlone: isolated.collectAlone.bind(isolated) } : {}),
    close: async (costs) => worker.close(costs),
  };
  return { ...context, deps: { ...context.deps, collector } };
}

/**
 * Run `body` over every index in `queue`, group by group, lane by lane.
 *
 * Each lane keeps up to `window` subjects in flight — its even share of
 * `concurrency`, rounded up, so at least one and in all at least as wide as
 * configured — and takes its next group only once it has started the last
 * subject of the one before. With one lane and a concurrency of one this is the loop a run
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
  /** The subject's steps, taken on the same clock; see `ObserveContext.steps`. */
  steps?: readonly Step[],
): Outcome {
  if (outcome.kind !== 'observed' || started === undefined || elapsed === undefined) return outcome;
  const record = {
    ...outcome.record,
    costMs: elapsed() - started,
    ...(steps === undefined ? {} : { steps: [...steps] }),
  };
  return { ...outcome, record: declaredIn === undefined ? record : { ...record, declaredIn } };
}
