import { describe, expect, it, vi } from 'vitest';
import { workersOf } from './lanes.js';
import { mergeReports } from './merge.js';
import type { Collector, Plan } from './run.js';
import type { Visit } from './collector.js';
import { collecting, planOf as storiesOf, rendered } from './evidence-fixture.js';
import { collectorOf, configOf, documentFor, painter, runWith, storeAnswering, whiteBaselineOf } from './run-fixture.js';

/**
 * Workers inside one shard, and `--shard` across machines.
 *
 * The claims are the ones ADR-0009 makes about one world, restated per lane —
 * one subject in a world at a time, a file's stories in one world — plus the
 * one that makes the setting safe to change: the report does not move.
 */

// The machine a run derives its width from has eight cores, whatever ran the tests.
vi.mock('node:os', async (original) => ({
  ...(await original<typeof import('node:os')>()),
  availableParallelism: () => 8,
}));

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
  /** What the run handed `close`: its time for each subject. */
  costs?: ReadonlyMap<string, number>;
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
      async close(costs) {
        world.closed = true;
        if (costs !== undefined) world.costs = costs;
      },
      ...(options.lanes === false
        ? {}
        : { openWorker: async () => worldCollector(`worker ${worlds.length}`) }),
    };
    return collector;
  }

  return { collector: worldCollector('main'), worlds };
}

/**
 * A suite whose shared worlds paint every subject dark and whose clean world
 * paints it white: every subject changes against a white baseline, and
 * matches it when run alone. A worker is a standing world and opens nothing
 * alone; the clean world is the run's collector's to open, as it is for the
 * shipped collectors.
 */
function leaking(plan: Plan): Collector & { readonly aloneCalls: string[] } {
  const dark = (id: string) => documentFor(id, '<div data-va-path="0" data-paint="dark">x</div>');
  const aloneCalls: string[] = [];
  const world = (): Collector => ({
    async plan() {
      return plan;
    },
    async collect(planned) {
      return { ok: true, document: dark(planned.subject.id) };
    },
    async close() {
      /* nothing to release */
    },
  });
  return {
    ...world(),
    aloneCalls,
    async collectAlone(planned) {
      aloneCalls.push(planned.subject.id);
      return { ok: true, document: documentFor(planned.subject.id) };
    },
    openWorker: async () => world(),
  };
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

  it('keeps where every world located a component, not only the last world to answer', async () => {
    const plan = storiesOf([['button--primary', 'src/Button.stories.tsx'], ['card--default', 'src/Card.stories.tsx']]);
    const owner = (id: string) => (id === 'card--default' ? 'Card' : 'Button');
    const { collector } = collecting(
      plan,
      (id) => {
        const collected = rendered(id, [{ owner: owner(id), text: id }]);
        return collected.ok ? { ...collected, source: { [owner(id)]: [{ file: `src/${owner(id)}.tsx`, line: 1, via: 'engine' as const }] } } : collected;
      },
      { delay: (id) => (id === 'button--primary' ? 10 : 0) },
    );
    const { report } = await runWith(configOf({ workers: 2 }), collector, storeAnswering(null));

    expect(report.lexicon?.declaredIn).toEqual({ Button: ['src/Button.tsx'], Card: ['src/Card.tsx'] });
  });

  it('says so when the collector cannot open another world, naming the width as declared', async () => {
    const { collector, worlds } = workingCollector(planOf(2, 1), { lanes: false });
    const { report } = await runWith(configOf({ workers: 3 }), collector, storeAnswering(null));

    expect(worlds).toHaveLength(1);
    expect(report.warnings).toContainEqual(expect.stringMatching(/^`workers` is 3, and this collector supplies no `openWorker`/));
  });

  it('runs a changed subject alone from whichever world read it, and says the same of it at any width', async () => {
    const baseline = whiteBaselineOf(documentFor('fixture:f0-s0'));
    const [one, three] = await Promise.all(
      [1, 3].map(async (workers) =>
        runWith(configOf({ workers }), leaking(planOf(4, 1)), storeAnswering(baseline), { renderer: painter() }),
      ),
    );

    expect(three!.report.workers).toBe(3);
    expect(one!.report.observations.map((o) => o.alone?.because)).toEqual(
      Array.from({ length: 4 }, () => expect.stringContaining('matches its baseline when run alone')),
    );
    expect(three!.report.observations).toEqual(one!.report.observations);
  });

  it('spends the budget on the same subjects at any width: the first to change in the order they were taken', async () => {
    // Three files of two, a budget of two. One world reaches both of the first
    // file's subjects before the second file's; three worlds finish the first
    // subject of every file before the second of any.
    const baseline = whiteBaselineOf(documentFor('fixture:f0-s0'));
    const [one, three] = await Promise.all(
      [1, 3].map(async (workers) => {
        const collector = leaking(planOf(3, 2));
        const { report } = await runWith(configOf({ workers, alone: { limit: 2 } }), collector, storeAnswering(baseline), {
          renderer: painter(),
        });
        return { report, alone: [...collector.aloneCalls].sort() };
      }),
    );

    expect(three!.report.workers).toBe(3);
    expect(one!.alone).toEqual(['fixture:f0-s0', 'fixture:f0-s1']);
    expect(three!.alone).toEqual(one!.alone);
    expect(one!.report.observations.map((o) => o.alone?.because)).toEqual([
      expect.stringContaining('matches its baseline when run alone'),
      expect.stringContaining('matches its baseline when run alone'),
      ...Array.from({ length: 4 }, () => expect.stringContaining('budget of 2 subjects spent')),
    ]);
    expect(three!.report.observations).toEqual(one!.report.observations);
  });

  it('takes half the machine when no width was declared, and exactly the width that was', () => {
    expect([16, 4, 3, 2, 1].map((cores) => workersOf(configOf(), cores))).toEqual([8, 2, 1, 1, 1]);
    expect(workersOf(configOf({ workers: 1 }), 16)).toBe(1);
    expect(workersOf(configOf({ workers: 12 }), 4)).toBe(12);
  });

  it('holds a derived width to a declared concurrency, which a declared width still overrides', () => {
    expect(workersOf(configOf({ concurrency: 1 }), 16)).toBe(1);
    expect(workersOf(configOf({ concurrency: 3 }), 16)).toBe(3);
    expect(workersOf(configOf({ concurrency: 12 }), 16)).toBe(8);
    expect(workersOf(configOf({ concurrency: 1, workers: 4 }), 16)).toBe(4);
  });

  it('collects side by side by default, and says how many worlds it read in', async () => {
    const { collector, worlds } = workingCollector(planOf(16, 1));
    const { report } = await runWith(configOf(), collector, storeAnswering(null));

    expect(worlds).toHaveLength(4);
    expect(report.workers).toBe(4);
  });

  it('opens no world it has no file for', async () => {
    const { collector, worlds } = workingCollector(planOf(2, 1));
    const { report } = await runWith(configOf({ workers: 3 }), collector, storeAnswering(null));

    expect(worlds).toHaveLength(2);
    expect(report.workers).toBe(2);
  });

  it('collects in one world without a word when the width was derived and the collector has one', async () => {
    const { collector, worlds } = workingCollector(planOf(4, 1), { lanes: false });
    const { report } = await runWith(configOf(), collector, storeAnswering(null));

    expect(worlds).toHaveLength(1);
    expect(report.workers).toBe(1);
    expect(report.warnings ?? []).not.toContainEqual(expect.stringMatching(/openWorker/));
  });

  it('records what each subject cost on the injected clock, and nothing without one', async () => {
    let now = 0;
    const clock = () => (now += 5);
    const timed = await runWith(configOf(), workingCollector(planOf(2, 1)).collector, storeAnswering(null), {
      elapsed: clock,
    });
    const untimed = await runWith(configOf(), workingCollector(planOf(2, 1)).collector, storeAnswering(null));

    expect(timed.report.observations.every((o) => typeof o.costMs === 'number' && o.costMs > 0)).toBe(true);
    // The file a shard places rides with the cost, so the next run can price the group.
    expect(timed.report.observations.map((o) => o.declaredIn)).toEqual(['f0.stories.tsx', 'f1.stories.tsx']);
    expect(untimed.report.observations.every((o) => !('costMs' in o) && !('declaredIn' in o))).toBe(true);
  });

  // One visit reads every width at once, so the visit's time belongs to the
  // story. A width that failed, or a glob left out, is no observation to carry
  // it, and the first width read carries it instead: summed over the story the
  // cost is still what the visit took, which is what placement prices.
  it('charges the visit to the first width read when a width before it was not', async () => {
    let now = 0;
    const story = 'story:card--default';
    const visit: Visit = {
      subjects: [
        { planned: { subject: { id: `${story}@375`, kind: 'story' } }, collected: { ok: false, because: 'the page threw' } },
        { planned: { subject: { id: `${story}@800`, kind: 'story' } }, collected: rendered(`${story}@800`) },
      ],
    };
    const { collector } = collecting(storiesOf([[story, 'card.tsx']]), () => {
      now += 100;
      return visit;
    });
    const { report } = await runWith(configOf({ workers: 1 }), collector, storeAnswering(null), { elapsed: () => (now += 5) });

    expect(report.observations.map((o) => o.subject)).toEqual([`${story}@800`]);
    expect(report.observations[0]!.costMs).toBeGreaterThanOrEqual(100);
  });

  it('hands the collector the time it recorded for each subject as it closes, so a recording carries the same figure', async () => {
    let now = 0;
    const { collector, worlds } = workingCollector(planOf(2, 1));
    const { report } = await runWith(configOf(), collector, storeAnswering(null), { elapsed: () => (now += 5) });

    expect(worlds[0]!.costs).toEqual(new Map(report.observations.map((o) => [o.subject, Math.round(o.costMs!)])));
  });
});

describe('steps', () => {
  /** A clock that moves five milliseconds every time it is read. */
  function ticking(): () => number {
    let now = 0;
    return () => (now += 5);
  }

  function steppedCollector(plan: Plan): Collector {
    return collectorOf(plan, (planned) => ({
      ok: true,
      document: documentFor(planned.subject.id),
      steps: [
        { step: 'navigate', ms: 30 },
        { step: 'wait-for-fonts', ms: 4 },
      ],
    }));
  }

  it('records each step of a subject in the order it ran, the collector\'s under `collect.`', async () => {
    const { report } = await runWith(configOf({ workers: 1 }), steppedCollector(planOf(1, 1)), storeAnswering(null), {
      elapsed: ticking(),
    });

    expect(report.observations[0]!.steps).toEqual([
      { step: 'collect.navigate', ms: 30 },
      { step: 'collect.wait-for-fonts', ms: 4 },
      { step: 'inspect', ms: 5 },
      { step: 'settle', ms: 5 },
      { step: 'baseline', ms: 5 },
      { step: 'cache.get', ms: 5 },
      { step: 'cache.put', ms: 5 },
      { step: 'write', ms: 5 },
    ]);
  });

  it('takes the decode, the comparison and the second reading of a subject that moved', async () => {
    const dark = documentFor('fixture:f0-s0', '<div data-va-path="0" data-paint="dark">x</div>');
    const collector = collectorOf(planOf(1, 1), () => ({ ok: true, document: dark }));
    const { report } = await runWith(configOf({ workers: 1 }), collector, storeAnswering(whiteBaselineOf(documentFor('fixture:f0-s0'))), {
      elapsed: ticking(),
      renderer: painter(),
    });

    expect(report.observations[0]!.verdict).toBe('changed');
    expect(report.observations[0]!.steps?.map((s) => s.step)).toEqual([
      'inspect',
      'settle',
      'baseline',
      'cache.get',
      'cache.put',
      'decode',
      'compare',
      'write',
      'again.collect',
    ]);
  });

  it('totals each step over the subjects that ran it, beside the worlds it ran in', async () => {
    const { report } = await runWith(configOf({ workers: 1 }), steppedCollector(planOf(3, 1)), storeAnswering(null), {
      elapsed: ticking(),
    });

    expect(report.workers).toBe(1);
    expect(report.steps).toContainEqual({ step: 'collect.navigate', ms: 90, subjects: 3 });
    for (const total of report.steps ?? []) {
      const ran = report.observations.flatMap((o) => o.steps ?? []).filter((s) => s.step === total.step);
      expect(total.ms).toBe(ran.reduce((sum, s) => sum + s.ms, 0));
    }
  });

  it('totals the merged subjects again on a merge, and carries no one width for every shard', async () => {
    const plan = planOf(4, 1);
    const shards = await Promise.all(
      [1, 2].map(async (index) =>
        runWith(configOf({ workers: 1 }), steppedCollector(plan), storeAnswering(null), {
          shard: { index, total: 2 },
          elapsed: ticking(),
        }),
      ),
    );
    const merged = mergeReports(shards.map(({ report }, i) => ({ path: `shard-${i + 1}.json`, report })));

    expect(merged.steps).toContainEqual({ step: 'collect.navigate', ms: 120, subjects: 4 });
    expect(merged).not.toHaveProperty('workers');
  });

  it('records no step, and no total, when the run has no clock', async () => {
    const { report } = await runWith(configOf(), steppedCollector(planOf(2, 1)), storeAnswering(null));

    expect(report.observations.every((o) => !('steps' in o))).toBe(true);
    expect(report).not.toHaveProperty('steps');
  });

  it('writes the same images and sidecars whatever the steps took', async () => {
    const slow = () => {
      let now = 0;
      return () => (now += 700);
    };
    const [quick, late] = await Promise.all([
      runWith(configOf({ workers: 1 }), steppedCollector(planOf(2, 1)), storeAnswering(null), { elapsed: ticking() }),
      runWith(configOf({ workers: 1 }), steppedCollector(planOf(2, 1)), storeAnswering(null), { elapsed: slow() }),
    ]);

    expect(quick.written.artifacts.size).toBeGreaterThan(0);
    expect(late.written.artifacts).toEqual(quick.written.artifacts);
    for (const bytes of quick.written.artifacts.values()) expect(bytes.toString('latin1')).not.toContain('"steps"');
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
        expect(entry.because).toMatch(/^assigned to shard \d\/2 by count/);
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
