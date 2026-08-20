import { describe, expect, it } from 'vitest';
import { RasterStoreError } from '@variance-authority/raster';
import type { Collector, Plan } from './run.js';
import { configOf, documentFor, runWith, storeAnswering } from './run-fixture.js';

/**
 * Concurrency, and the two things it must not cost.
 *
 * Going wide over the raster tier is the largest lever a run has — painting
 * costs roughly an order of magnitude more than collecting — but it is worth
 * nothing if it makes the
 * report a function of timing, and it is actively dangerous if it lets two
 * subjects into the collector's one standing world at the same time.
 */
describe('running subjects concurrently', () => {
  function planOf(count: number): Plan {
    return {
      subjects: Array.from({ length: count }, (_, i) => ({
        subject: { id: `fixture:${i}`, kind: 'fixture' as const },
      })),
      notObserved: [],
      warnings: [],
    };
  }

  /** A collector that records how many collections overlap, and reorders on purpose. */
  function watched(plan: Plan): Collector & { peak: () => number } {
    let inFlight = 0;
    let peak = 0;

    return {
      peak: () => peak,
      async plan() {
        return plan;
      },
      async collect(subject) {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        // Later subjects finish first, so anything that recorded results in
        // completion order comes out visibly shuffled.
        const index = Number(subject.subject.id.split(':')[1]);
        await new Promise((resolve) => setTimeout(resolve, (10 - index) * 2));
        inFlight -= 1;
        return { ok: true, document: documentFor(subject.subject.id) };
      },
      async close() {
        /* nothing to release */
      },
    };
  }

  it('writes observations in plan order however they finish', async () => {
    // The determinism claim, and the reason it is asserted rather than assumed:
    // `variance run` producing a different file from the same inputs would undo
    // the argument the whole tool rests on. This collector finishes in reverse.
    const plan = planOf(8);
    const { report } = await runWith(
      configOf({ concurrency: 4 }),
      watched(plan),
      storeAnswering(null),
    );

    expect(report.observations.map((o) => o.subject)).toEqual(
      plan.subjects.map((s) => s.subject.id),
    );
  });

  it('never lets two collections overlap, however wide the run is', async () => {
    // ADR-0009's world is shared. Two subjects mounted into one document let
    // each decide the other's verdict, so this is the one stage that may not go
    // wide no matter what the operator configures.
    const collector = watched(planOf(8));
    await runWith(configOf({ concurrency: 8 }), collector, storeAnswering(null));

    expect(collector.peak()).toBe(1);
  });

  it('produces the same report at concurrency 1 and 8', async () => {
    // The property that makes the setting safe to change: it may alter what a
    // run costs and may not alter what it says.
    const [serialRun, wideRun] = await Promise.all([
      runWith(configOf({ concurrency: 1 }), watched(planOf(6)), storeAnswering(null)),
      runWith(configOf({ concurrency: 8 }), watched(planOf(6)), storeAnswering(null)),
    ]);

    expect(wideRun.report.observations).toEqual(serialRun.report.observations);
    expect(wideRun.report.notObserved).toEqual(serialRun.report.notObserved);
  });

  it('reports a store failure once, without letting the other lanes bury it', async () => {
    // Thrown after the pool drains rather than out of a worker: throwing while
    // seven other subjects are mid-render races whichever of them rejects next,
    // and the operator gets an arbitrary one of eight identical errors.
    const store = storeAnswering(() => {
      throw new RasterStoreError('the endpoint is unreachable');
    });

    await expect(
      runWith(configOf({ concurrency: 4 }), watched(planOf(6)), store),
    ).rejects.toThrow(/the baseline store failed while observing/);
  });
});
