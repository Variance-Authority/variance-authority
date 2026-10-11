import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import caseOwner from './case-owner.cjs';
import journals from './journal-format.cjs';
import {
  JOURNEY_COOKIE,
  collectJourneys,
  journeyOf,
  mintJourney,
  stitchJourneys,
  type JourneyTrace,
} from './journey.js';
import { driver, forget, head, inRoot } from './__fixtures__/journey-head.js';

afterEach(forget);

describe('the wire', () => {
  it('finds the journey among the cookies an application already sets', () => {
    expect(journeyOf(`theme=dark; ${JOURNEY_COOKIE}=abc-123; session=xyz`)).toBe('abc-123');
    expect(journeyOf(`${JOURNEY_COOKIE}=abc-123`)).toBe('abc-123');
    expect(journeyOf('theme=dark')).toBeUndefined();
    expect(journeyOf(`${JOURNEY_COOKIE}=`)).toBeUndefined();
    expect(journeyOf(undefined)).toBeUndefined();
    // A cookie whose name merely ends the same way is a different cookie.
    expect(journeyOf(`x-${JOURNEY_COOKIE}=abc-123`)).toBeUndefined();
  });

  it('mints an id that carries no subject name', () => {
    expect(mintJourney()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(mintJourney()).not.toBe(mintJourney());
  });

  it('counts traffic the run did not drive rather than attributing it', async () => {
    await inRoot(async (root) => {
      const driven = await driver();
      const collector = collectJourneys({ head: 'api', enabled: true });
      const parts = await head(root);
      await collector.enter(driven.carrying('a-journey-nobody-minted'), () => parts.currency('de'));
      await collector.close();

      const stitched = stitchJourneys({
        reports: driven.reports,
        heads: ['api'],
        owners: new Map(),
      });
      expect(stitched.unclaimed).toBe(1);
      expect(stitched.heads.get('api')).toEqual([]);
    });
  });
});

describe('a head told which trace is running', () => {
  /** A tracer whose running trace is whatever the test last set. */
  const tracer = (): JourneyTrace & { running: string | undefined; asked: number } => {
    const trace = {
      name: 'tracer',
      running: undefined as string | undefined,
      asked: 0,
      carry: <Result,>(_journey: string, _name: string, body: () => Result): Result => body(),
      current: () => {
        trace.asked += 1;
        return trace.running;
      },
    };
    return trace;
  };

  /** Regions entered per journey across a directory of parts. */
  const partsIn = async (directory: string): Promise<Map<string, number>> => {
    const journeys = new Map<string, number>();
    for (const name of await readdir(directory)) {
      const bytes = await readFile(resolve(directory, name));
      for (let at = 0; at < bytes.length;) {
        const length = bytes.readUInt32LE(at);
        const frame = journals.decodeJournal(bytes.subarray(at + 4, at + 4 + length));
        at += 4 + length;
        const hits = frame.modules.reduce((sum, module) => sum + module.hits.length, 0);
        const journey = caseOwner.journeyOf(frame.testFile);
        journeys.set(journey, (journeys.get(journey) ?? 0) + hits);
      }
    }
    return journeys;
  };

  it('asks the trace wherever enter did not say, after a build installed it untold', async () => {
    await inRoot(async (root) => {
      const directory = resolve(root, 'parts');
      // What a build installs at global scope, before the application has
      // initialized its tracing.
      const installed = collectJourneys({ head: 'api', parts: directory });
      const trace = tracer();
      expect(collectJourneys({ trace })).toBe(installed);
      const parts = await head(root);

      trace.running = 'a'.repeat(32);
      parts.currency('de');
      trace.running = 'b'.repeat(32);
      parts.currency('en');
      await installed.close();

      expect(trace.asked).toBeGreaterThan(0);
      const journeys = await partsIn(directory);
      expect([...journeys.keys()].filter((journey) => journey !== '').sort()).toEqual(['a'.repeat(32), 'b'.repeat(32)]);
      expect(journeys.get('a'.repeat(32))).toBeGreaterThan(0);
      expect(journeys.get('b'.repeat(32))).toBeGreaterThan(0);
    });
  });

  it('lets the journey enter names outrank the trace', async () => {
    await inRoot(async (root) => {
      const directory = resolve(root, 'parts');
      const trace = tracer();
      const collector = collectJourneys({ head: 'api', parts: directory, trace });
      const parts = await head(root);
      trace.running = 'c'.repeat(32);
      await collector.enter(`${JOURNEY_COOKIE}=${'d'.repeat(32)}`, () => parts.currency('de'));
      await collector.close();

      const journeys = await partsIn(directory);
      expect(journeys.get('d'.repeat(32))).toBeGreaterThan(0);
      expect(journeys.has('c'.repeat(32))).toBe(false);
    });
  });

  it('refuses a trace for a head that reports home, since a trace carries no way back', async () => {
    const trace = tracer();
    expect(() => collectJourneys({ head: 'api', enabled: true, trace })).toThrow(
      'a tracer trace carries the journey and no way home',
    );
    const installed = collectJourneys({ head: 'api', enabled: true });
    try {
      expect(() => collectJourneys({ trace })).toThrow('a tracer trace carries the journey and no way home');
    } finally {
      await installed.close();
    }
  });
});
