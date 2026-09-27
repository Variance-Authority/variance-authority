import { describe, expect, it } from 'vitest';
import { mergeReports } from './merge.js';
import type { Collector, Plan } from './run.js';
import { configOf, documentFor, runWith, storeAnswering } from './run-fixture.js';

/**
 * Workers inside one shard, and `--shard` across machines.
 *
 * The claims are the ones ADR-0009 makes about one world, restated per lane —
 * one subject in a world at a time, a file's stories in one world — plus the
 * one that makes the setting safe to change: the report does not move.
 */

function planOf(files: number, perFile: number): Plan {
  return {
    subjects: Array.from({ length: files }, (_, f) =>
      Array.from({ length: perFile }, (_, s) => ({
        subject: { id: `fixture:f${f}-s${s}`, kind: 'fixture' as const },
        declaredIn: `f${f}.stories.tsx`,
      })),
    ).flat(),
    notObserved: [],
    warnings: [],
  };
}

interface World {
  readonly name: string;
  readonly seen: string[];
  peak: number;
  closed: boolean;
}

/** A collector whose `openWorker` opens a world that records what it collected. */
function workingCollector(plan: Plan, options: { readonly lanes?: boolean } = {}) {
  const worlds: World[] = [];

  function worldCollector(name: string): Collector {
    const world: World = { name, seen: [], peak: 0, closed: false };
    worlds.push(world);
    let inFlight = 0;
    const collector: Collector = {
      async plan() {
        return plan;
      },
      async collect(subject) {
        inFlight += 1;
        world.peak = Math.max(world.peak, inFlight);
        world.seen.push(subject.subject.id);
        await new Promise((resolve) => setTimeout(resolve, 2));
        inFlight -= 1;
        return { ok: true, document: documentFor(subject.subject.id) };
      },
      async close() {
        world.closed = true;
      },
      ...(options.lanes === false
        ? {}
        : { openWorker: async () => worldCollector(`worker ${worlds.length}`) }),
    };
    return collector;
  }

  return { collector: worldCollector('main'), worlds };
}

describe('workers', () => {
  it('collects in every world, one subject at a time in each, and never splits a file', async () => {
    const { collector, worlds } = workingCollector(planOf(6, 3));
    await runWith(configOf({ workers: 3, concurrency: 6 }), collector, storeAnswering(null));

    expect(worlds).toHaveLength(3);
    for (const world of worlds) {
      expect(world.seen.length).toBeGreaterThan(0);
      expect(world.peak).toBe(1);
    }
    const worldOf = new Map(worlds.flatMap((world) => world.seen.map((id) => [id, world.name])));
    for (let f = 0; f < 6; f++) {
      expect(new Set([0, 1, 2].map((s) => worldOf.get(`fixture:f${f}-s${s}`))).size).toBe(1);
    }
  });

  it('closes every world it opened', async () => {
    const { collector, worlds } = workingCollector(planOf(4, 1));
    await runWith(configOf({ workers: 2 }), collector, storeAnswering(null));

    expect(worlds.map((world) => world.closed)).toEqual([true, true]);
  });

  it('writes the same report with one worker and with three', async () => {
    const [one, three] = await Promise.all([
      runWith(configOf({ workers: 1 }), workingCollector(planOf(5, 2)).collector, storeAnswering(null)),
      runWith(configOf({ workers: 3 }), workingCollector(planOf(5, 2)).collector, storeAnswering(null)),
    ]);

    expect(three.report.observations).toEqual(one.report.observations);
    expect(three.report.warnings).toEqual(one.report.warnings);
  });

  it('says so when the collector cannot open another world', async () => {
    const { collector, worlds } = workingCollector(planOf(2, 1), { lanes: false });
    const { report } = await runWith(configOf({ workers: 2 }), collector, storeAnswering(null));

    expect(worlds).toHaveLength(1);
    expect(report.warnings).toContainEqual(expect.stringMatching(/supplies no `openWorker`/));
  });

  it('records what each subject cost on the injected clock, and nothing without one', async () => {
    let now = 0;
    const clock = () => (now += 5);
    const timed = await runWith(configOf(), workingCollector(planOf(2, 1)).collector, storeAnswering(null), {
      elapsed: clock,
    });
    const untimed = await runWith(configOf(), workingCollector(planOf(2, 1)).collector, storeAnswering(null));

    expect(timed.report.observations.every((o) => typeof o.costMs === 'number' && o.costMs > 0)).toBe(true);
    expect(untimed.report.observations.every((o) => !('costMs' in o))).toBe(true);
  });
});

describe('--shard', () => {
  it('observes its own files, excludes the rest by owner, and merges back into the whole', async () => {
    const plan = planOf(8, 2);
    const shards = await Promise.all(
      [1, 2].map(async (index) =>
        runWith(configOf(), workingCollector(plan).collector, storeAnswering(null), {
          shard: { index, total: 2 },
        }),
      ),
    );

    for (const { report } of shards) {
      expect(report.observations.length).toBeGreaterThan(0);
      for (const entry of report.notObserved ?? []) {
        expect(entry.because).toMatch(/^assigned to shard \d\/2 by checksum/);
      }
    }

    const merged = mergeReports(shards.map(({ report }, i) => ({ path: `shard-${i + 1}.json`, report })));
    const ids = (list: readonly string[]) => [...list].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(ids(merged.observations.map((o) => o.subject))).toEqual(ids(plan.subjects.map((s) => s.subject.id)));
    expect(merged.notObserved).toEqual([]);
  });

  it('writes its part of the suite index for the merge, and an unsharded run writes none', async () => {
    const plan = planOf(4, 1);
    const sharded = await runWith(configOf(), workingCollector(plan).collector, storeAnswering(null), {
      shard: { index: 2, total: 2 },
    });
    const whole = await runWith(configOf(), workingCollector(plan).collector, storeAnswering(null));

    expect(sharded.written.parts).toMatchObject([{ version: 1, shard: { index: 2, total: 2 }, planned: 4 }]);
    expect(whole.written.parts).toEqual([]);
  });

  it('balances on the costs it is given, and names their commit', async () => {
    const plan = planOf(4, 1);
    const costs = new Map(plan.subjects.map((planned, i) => [planned.subject.id, (i + 1) * 100]));
    const { report } = await runWith(configOf(), workingCollector(plan).collector, storeAnswering(null), {
      shard: { index: 1, total: 2 },
      costs: { commit: 'feedfacecafebeef', costs },
    });

    // 400 and 100 on one shard, 300 and 200 on the other.
    expect(report.observations.map((o) => o.subject)).toEqual(['fixture:f0-s0', 'fixture:f3-s0']);
    expect(report.notObserved?.[0]?.because).toMatch(/the costs recorded at feedfacecafe/);
  });
});
