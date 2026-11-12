import { afterEach, describe, expect, it } from 'vitest';
import { collectJourneys, mintJourney, type JourneyReport } from './journey.js';
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
});
