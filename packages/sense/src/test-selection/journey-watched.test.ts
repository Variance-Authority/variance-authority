import { afterEach, describe, expect, it } from 'vitest';
import { WATCHER_VARIABLE } from '@variance-authority/wire';
import { collectJourneys, JOURNEY_VARIABLE, mintJourney, type JourneyReport } from './journey.js';
import { UNATTRIBUTED } from './stitch.js';
import { driver, forget, head, inRoot, until } from './__fixtures__/journey-head.js';

afterEach(forget);

/** The ordinals each execution entered in the one module the fixture builds, by journey. */
function entered(reports: readonly JourneyReport[]): Map<string, number[]> {
  const byJourney = new Map<string, number[]>();
  for (const report of reports) {
    if (report.journey === UNATTRIBUTED) continue;
    const hits = report.modules.flatMap((module) => module.hits);
    byJourney.set(report.journey, [...(byJourney.get(report.journey) ?? []), ...hits]);
  }
  return byJourney;
}

describe('a head told where a watcher listens', () => {
  it('reports a request nobody drove as an execution of its own', async () => {
    await inRoot(async (root) => {
      const watcher = await driver();
      const collector = collectJourneys({ head: 'api', enabled: true, watcher: watcher.origin });
      const parts = await head(root);

      expect(await collector.enter(undefined, () => parts.currency('de'))).toBe('1200 euros');
      await collector.close();

      const executions = entered(watcher.reports);
      expect(executions.size).toBe(1);
      expect([...executions.values()][0]!.length).toBeGreaterThan(0);
      expect(watcher.reports.every((report) => report.head === 'api')).toBe(true);
    });
  });

  it('keeps two such requests apart while they interleave', async () => {
    await inRoot(async (root) => {
      const watcher = await driver();
      const collector = collectJourneys({ head: 'api', enabled: true, watcher: watcher.origin });
      const parts = await head(root);

      await Promise.all([
        collector.enter('theme=dark', () => parts.currency('de')),
        collector.enter('theme=dark', () => parts.currency('en')),
      ]);
      await collector.close();

      const [first, second] = [...entered(watcher.reports).values()];
      expect(first).toBeDefined();
      expect(second).toBeDefined();
      // Each took one branch of `currency`, so each holds a region the other lacks.
      expect(first!.some((ordinal) => !second!.includes(ordinal))).toBe(true);
      expect(second!.some((ordinal) => !first!.includes(ordinal))).toBe(true);
    });
  });

  it('leaves a request a test drove to the test', async () => {
    await inRoot(async (root) => {
      const watcher = await driver();
      const driven = await driver();
      const collector = collectJourneys({ head: 'api', enabled: true, watcher: watcher.origin });
      const parts = await head(root);
      const journey = mintJourney();

      await collector.enter(driven.carrying(journey), () => parts.currency('de'));
      await collector.close();

      await until(() => driven.reports.some((report) => report.settled === 1));
      expect(entered(driven.reports).has(journey)).toBe(true);
      expect(watcher.reports).toEqual([]);
    });
  });

  it('is told nothing by a head that was not enabled', async () => {
    const watcher = await driver();
    const collector = collectJourneys({ head: 'api', enabled: false, watcher: watcher.origin });

    expect(collector.enter(undefined, () => 41 + 1)).toBe(42);
    await collector.close();

    expect(collector.collecting).toBe(false);
    expect(watcher.reports).toEqual([]);
  });

  it('does not open a second execution for a request already inside one', async () => {
    await inRoot(async (root) => {
      const watcher = await driver();
      const collector = collectJourneys({ head: 'api', enabled: true, watcher: watcher.origin });
      const parts = await head(root);

      await collector.enter(undefined, () => collector.enter(undefined, () => parts.currency('de')));
      await collector.close();

      expect(entered(watcher.reports).size).toBe(1);
    });
  });

  it('gives a driver what a request nobody drove entered, as it would with no watcher', async () => {
    await inRoot(async (root) => {
      const watcher = await driver();
      const driven = await driver();
      const collector = collectJourneys({ head: 'api', enabled: true, watcher: watcher.origin });
      const parts = await head(root);

      // The undriven request is the only one to take the euro branch.
      await collector.enter(undefined, () => parts.currency('de'));
      await collector.enter(driven.carrying(mintJourney()), () => parts.currency('en'));
      await collector.close();
      await until(() => driven.reports.some((report) => report.settled === 1));

      const [undriven] = [...entered(watcher.reports).values()];
      const told = new Set(driven.reports.flatMap((report) => report.modules.flatMap((module) => module.hits)));
      expect(undriven!.length).toBeGreaterThan(0);
      expect(undriven!.filter((ordinal) => !told.has(ordinal))).toEqual([]);
      // And the watcher is not told what only that request ran a second time, as the process's.
      const common = watcher.reports.filter((report) => report.journey === UNATTRIBUTED);
      const again = new Set(common.flatMap((report) => report.modules.flatMap((module) => module.hits)));
      const dollars = [...entered(driven.reports).values()].flat();
      const euros = undriven!.filter((ordinal) => !dollars.includes(ordinal));
      expect(euros.length).toBeGreaterThan(0);
      expect(euros.filter((ordinal) => again.has(ordinal))).toEqual([]);
    });
  });

  it('gives a driver what a request nobody drove has entered so far, while that request is still open', async () => {
    await inRoot(async (root) => {
      const watcher = await driver();
      const driven = await driver();
      const collector = collectJourneys({ head: 'api', enabled: true, watcher: watcher.origin });
      const parts = await head(root);
      let finish!: () => void;
      const held = new Promise<void>((resolve) => (finish = resolve));

      // A stream, or a health check that hangs: it took the euro branch and has not settled.
      const open = collector.enter(undefined, async () => {
        parts.currency('de');
        await held;
      });
      await collector.enter(driven.carrying(mintJourney()), () => parts.currency('en'));
      await until(() => driven.reports.some((report) => report.journey === UNATTRIBUTED));
      const told = new Set(driven.reports.flatMap((report) => report.modules.flatMap((module) => module.hits)));

      finish();
      await open;
      await collector.close();
      const undriven = [...entered(watcher.reports).values()].flat();
      expect(undriven.length).toBeGreaterThan(0);
      expect(undriven.filter((ordinal) => !told.has(ordinal))).toEqual([]);
    });
  });

  it('tells the watcher what ran outside every request, though a request ran the same', async () => {
    await inRoot(async (root) => {
      const watcher = await driver();
      const collector = collectJourneys({ head: 'api', enabled: true, watcher: watcher.origin });
      const parts = await head(root);

      // Before any request, as a warm-up at start does; then a request takes the same branch.
      await parts.currency('de');
      await collector.enter(undefined, () => parts.currency('de'));
      await collector.close();

      const outside = new Set(
        watcher.reports
          .filter((report) => report.journey === UNATTRIBUTED)
          .flatMap((report) => report.modules.flatMap((module) => module.hits)),
      );
      const own = [...entered(watcher.reports).values()].flat();
      expect(own.length).toBeGreaterThan(0);
      expect(own.filter((ordinal) => !outside.has(ordinal))).toEqual([]);
    });
  });

  it('does not count a report the watcher missed against a test', async () => {
    await inRoot(async (root) => {
      const driven = await driver();
      // A watcher that was stopped: its address is still in the service's environment.
      const collector = collectJourneys({ head: 'api', enabled: true, watcher: 'http://127.0.0.1:9' });
      const parts = await head(root);

      await collector.enter(undefined, () => parts.currency('de'));
      await collector.flush();
      await collector.enter(driven.carrying(mintJourney()), () => parts.currency('en'));
      await collector.close();
      await until(() => driven.reports.some((report) => report.settled === 1));

      expect(driven.reports.filter((report) => report.lost !== undefined)).toEqual([]);
    });
  });

  it('reads the address from the environment, and stays off where journeys were not asked for', async () => {
    await inRoot(async (root) => {
      const watcher = await driver();
      process.env[WATCHER_VARIABLE] = watcher.origin;
      try {
        // A watched suite exports the same variable to a service that never asked for journeys.
        expect(collectJourneys({ head: 'api' }).collecting).toBe(false);

        process.env[JOURNEY_VARIABLE] = '1';
        const collector = collectJourneys({ head: 'api' });
        const parts = await head(root);
        await collector.enter(undefined, () => parts.currency('de'));
        await collector.close();
        expect(entered(watcher.reports).size).toBe(1);
      } finally {
        delete process.env[WATCHER_VARIABLE];
        delete process.env[JOURNEY_VARIABLE];
      }
    });
  });

  it('refuses a watcher address it cannot reach, since a head told nothing looks like a quiet one', () => {
    expect(() => collectJourneys({ head: 'api', enabled: true, watcher: 'http://example.com:9' })).toThrow(/watcher/);
  });
});
