import { JOURNEY_COOKIE, RETURN_COOKIE } from '@variance-authority/wire';
import { listen } from '@variance-authority/wire/listen';
import { afterEach, describe, expect, it } from 'vitest';
import { driveJourneys } from './journey-driver.js';
import { collectJourneys, unsettledScopes } from './journey.js';
import { forget, head, inRoot } from './__fixtures__/journey-head.js';

afterEach(forget);

const header = (cookies: readonly { name: string; value: string }[]): string =>
  cookies.map(({ name, value }) => `${name}=${value}`).join('; ');

describe('a driver of journeys', () => {
  it('mints one journey and the cookies that carry it, both scoped to the origin', async () => {
    const driver = driveJourneys();
    try {
      const { journey, cookies } = await driver.mint('http://localhost:8797');
      expect(cookies.map(({ name, url }) => [name, url])).toEqual([
        [JOURNEY_COOKIE, 'http://localhost:8797'],
        [RETURN_COOKIE, 'http://localhost:8797'],
      ]);
      expect(cookies[0]!.value).toBe(journey);
      expect(cookies[1]!.value).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
    } finally {
      await driver.close();
    }
  });

  it('hears what a head ran under its journey, and waits for a request still being served', async () => {
    await inRoot(async (root) => {
      const driver = driveJourneys();
      const collector = collectJourneys({ head: 'api', enabled: true });
      try {
        const parts = await head(root);
        const { journey, cookies } = await driver.mint('http://localhost');
        let respond = (): void => {};
        const tail = new Promise<void>((settle) => (respond = settle));
        const serving = collector.enter(header(cookies), async () => {
          await tail;
          return parts.currency('de');
        });
        // The head says it is serving before the driver waits: a report still
        // on its way is not one the driver can wait for.
        for (const deadline = Date.now() + 5_000; unsettledScopes(driver.reports).size === 0; ) {
          if (Date.now() > deadline) throw new Error('the head never said it was serving');
          await new Promise((settle) => setTimeout(settle, 10));
        }
        // Released while the driver is already waiting, which is the order a
        // streamed body arrives in.
        setTimeout(respond, 20);
        await driver.settled();

        expect(unsettledScopes(driver.reports).size).toBe(0);
        await serving;
        const mine = driver.reports.filter((report) => report.journey === journey && report.settled === 1);
        expect(mine[0]?.modules.length).toBeGreaterThan(0);
      } finally {
        await collector.close();
        await driver.close();
      }
    });
  });

  it('leaves a listener it was handed open when it closes', async () => {
    const wire = await listen();
    try {
      const driver = driveJourneys(wire);
      const { cookies } = await driver.mint('http://localhost');
      await driver.close();
      expect(cookies[1]!.value.startsWith(wire.origin)).toBe(true);
      const answer = await fetch(`${wire.origin}/`, { method: 'GET' }).catch(() => undefined);
      expect(answer).toBeDefined();
    } finally {
      await wire.close();
    }
  });
});
