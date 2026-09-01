// The claim under test is that one call reaches a driver from any of the three
// realms a participant can find itself in, that the caller cannot tell which one
// it got, and that the half which may not be lost is not lost — while the half
// that may be is never allowed to break the process it is observing.

import { setTimeout as after } from 'node:timers/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { JOURNEY_COOKIE, RETURN_COOKIE, channelFrom } from './index.js';
import { installCarrier, listen, type Wire } from './listen.js';

const listening: Wire[] = [];
const uninstalled: (() => void)[] = [];

interface Taken {
  readonly journey: string | undefined;
  readonly body: unknown;
}

async function driver(): Promise<{ taken: Taken[]; carrying: (journey: string) => string; wire: Wire }> {
  const taken: Taken[] = [];
  const wire = await listen();
  listening.push(wire);
  wire.on('events', (journey, body) => taken.push({ journey, body }));
  wire.on('journeys', (journey, body) => taken.push({ journey, body }));
  return {
    taken,
    carrying: (journey) =>
      `${JOURNEY_COOKIE}=${journey}; ${RETURN_COOKIE}=${wire.addressFor(journey)}`,
    wire,
  };
}

afterEach(async () => {
  for (const give of uninstalled.splice(0)) give();
  for (const wire of listening.splice(0)) await wire.close();
});

describe('the way home a request carried', () => {
  it('is nothing at all when nobody left one', () => {
    expect(channelFrom(undefined)).toBeUndefined();
    expect(channelFrom('theme=dark')).toBeUndefined();
    // An execution with no address is a run that drove this request and cannot
    // hear the answer, which is the same silence as no run at all.
    expect(channelFrom(`${JOURNEY_COOKIE}=journey-one`)).toBeUndefined();
  });

  it('names the execution among the cookies an application already sets', async () => {
    const { carrying } = await driver();
    const channel = channelFrom(`session=abc; ${carrying('journey-one')}; theme=dark`);
    expect(channel?.journey).toBe('journey-one');
  });

  it('refuses an address that is not loopback, and one that is not http', async () => {
    const { carrying } = await driver();
    const elsewhere = carrying('journey-one').replace('127.0.0.1', 'example.com');
    const secure = carrying('journey-one').replace('http://', 'https://');
    // The value is written by whoever is talking to this process. A participant
    // that posts wherever it is told is a way to reach whatever it can reach.
    expect(channelFrom(elsewhere)).toBeUndefined();
    expect(channelFrom(secure)).toBeUndefined();
  });

  it('prefers a carrier in this realm to an address across a socket', async () => {
    const near = await driver();
    const far = await driver();
    uninstalled.push(installCarrier(near.wire.carrier));

    channelFrom(far.carrying('journey-one'))?.report('events', { said: 'decided' });

    await expect.poll(() => near.taken.length).toBe(1);
    expect(near.taken[0]).toEqual({ journey: 'journey-one', body: { said: 'decided' } });
    expect(far.taken).toEqual([]);
  });
});

describe('what may be lost', () => {
  it('keeps one execution’s reports in the order they were said', async () => {
    const { taken, carrying } = await driver();
    const channel = channelFrom(carrying('journey-one'))!;

    for (const ordinal of [1, 2, 3, 4, 5]) channel.report('events', { ordinal });

    await expect.poll(() => taken.length).toBe(5);
    expect(taken.map((one) => (one.body as { ordinal: number }).ordinal)).toEqual([1, 2, 3, 4, 5]);
  });

  it('does not break the process it is observing when the driver has gone', async () => {
    const { carrying } = await driver();
    const channel = channelFrom(carrying('journey-one'))!;
    for (const wire of listening.splice(0)) await wire.close();

    expect(() => channel.report('events', { said: 'decided' })).not.toThrow();
    await after(50);
  });

  it('swallows a refusal rather than surfacing it in the subject', async () => {
    const { carrying, wire } = await driver();
    const channel = channelFrom(carrying('journey-one'))!;
    wire.on('events', () => {})();

    expect(() => channel.report('events', { said: 'decided' })).not.toThrow();
    await after(50);
  });
});

describe('what may not be lost', () => {
  it('is answered before the caller is told it landed', async () => {
    const { taken, carrying } = await driver();
    const channel = channelFrom(carrying('journey-one'))!;

    await channel.deliver('journeys', { modules: [] });

    // No poll: the promise settling is the acknowledgement, which is the whole
    // difference between this half and the other one.
    expect(taken).toEqual([{ journey: 'journey-one', body: { modules: [] } }]);
  });

  it('says so when nothing here takes it', async () => {
    const { wire, carrying } = await driver();
    const channel = channelFrom(carrying('journey-one'))!;
    wire.on('journeys', () => {})();

    await expect(channel.deliver('journeys', { modules: [] })).rejects.toThrow('404');
  });

  it('says so when the driver has gone away', async () => {
    const { carrying } = await driver();
    const channel = channelFrom(carrying('journey-one'))!;
    for (const wire of listening.splice(0)) await wire.close();

    await expect(channel.deliver('journeys', { modules: [] })).rejects.toThrow();
  });

  it('is acknowledged in a realm the driver is inside, without a hop', async () => {
    const { taken, wire } = await driver();
    uninstalled.push(installCarrier(wire.carrier));
    const channel = channelFrom(`${JOURNEY_COOKIE}=journey-one`)!;

    await channel.deliver('journeys', { modules: [] });

    expect(taken).toEqual([{ journey: 'journey-one', body: { modules: [] } }]);
  });
});
