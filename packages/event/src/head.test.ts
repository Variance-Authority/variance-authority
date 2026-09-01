// The claim under test is that a process serving several executions at once
// answers each announcement to the driver that asked for it, in the order it
// said them, that a process nobody configured says nothing at all, and that the
// whole channel is a socket held open for the length of a run: no file is opened
// anywhere in here, and none is left behind.

import { setTimeout as after } from 'node:timers/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { JOURNEY_COOKIE, RETURN_COOKIE } from '@variance-authority/wire';
import { installCarrier, listen, type Wire } from '@variance-authority/wire/listen';
import {
  EVENT_HEAD_VARIABLE,
  EVENT_VARIABLE,
  collectEvents,
  type EventCollector,
  type HeadEventReport,
} from './head.js';
import { vae, vaEnd, vaStart } from './index.js';

interface Heard {
  readonly journey: string | undefined;
  readonly report: HeadEventReport;
}

const opened: EventCollector[] = [];
const listening: Wire[] = [];
const uninstalled: (() => void)[] = [];

/** A driver listening on loopback, and everything it has been told so far. */
async function driver(): Promise<{
  heard: Heard[];
  /** The `Cookie` header a request driven by this execution carries. */
  carrying: (journey: string) => string;
  wire: Wire;
}> {
  const heard: Heard[] = [];
  const wire = await listen();
  listening.push(wire);
  wire.on('events', (journey, body) => heard.push({ journey, report: body as HeadEventReport }));
  return {
    heard,
    carrying: (journey) =>
      `${JOURNEY_COOKIE}=${journey}; ${RETURN_COOKIE}=${wire.addressFor(journey)}`,
    wire,
  };
}

function collect(head = 'api'): EventCollector {
  const collector = collectEvents({ enabled: true, head });
  opened.push(collector);
  return collector;
}

/** What a driver has heard, once as much of it as was promised has arrived. */
async function settled(heard: readonly Heard[], count: number): Promise<readonly Heard[]> {
  await expect.poll(() => heard.length).toBe(count);
  return heard;
}

afterEach(async () => {
  for (const give of uninstalled.splice(0)) give();
  for (const collector of opened.splice(0)) collector.close();
  for (const wire of listening.splice(0)) await wire.close();
  delete process.env[EVENT_VARIABLE];
  delete process.env[EVENT_HEAD_VARIABLE];
});

describe('collectEvents', () => {
  it('installs nothing when nothing says this process is under a run', () => {
    const collector = collectEvents({ head: 'api' });
    expect(collector.collecting).toBe(false);
    expect(
      collector.enter(`${JOURNEY_COOKIE}=a-journey`, () => vae('checkout', 'upsell', 'decided')),
    ).toBeUndefined();
  });

  it('reads the run and the head from the environment', async () => {
    process.env[EVENT_VARIABLE] = '1';
    process.env[EVENT_HEAD_VARIABLE] = 'pricing';
    const collector = collectEvents();
    opened.push(collector);
    const { heard, carrying } = await driver();

    expect(collector.head).toBe('pricing');
    collector.enter(carrying('a-journey'), () => vae('checkout', 'upsell', 'decided'));

    expect((await settled(heard, 1))[0]?.report.head).toBe('pricing');
  });

  it('answers the driver that owns the execution it was serving', async () => {
    const collector = collect();
    const { heard, carrying } = await driver();

    collector.enter(carrying('journey-one'), () => vae('checkout', 'upsell', 'decided'));

    expect(await settled(heard, 1)).toEqual([
      {
        journey: 'journey-one',
        report: {
          version: 1,
          head: 'api',
          phase: 'once',
          location: 'checkout',
          subject: 'upsell',
          action: 'decided',
        },
      },
    ]);
  });

  it('finds the address among the cookies an application already sets', async () => {
    const collector = collect();
    const { heard, carrying } = await driver();

    collector.enter(`session=abc; ${carrying('journey-one')}; theme=dark`, () =>
      vae('checkout', 'upsell', 'decided'),
    );

    expect((await settled(heard, 1))[0]?.journey).toBe('journey-one');
  });

  it('keeps two concurrent executions apart', async () => {
    // The reason an execution is on the wire at all: without it, one test's wait
    // is satisfied by another test's decision and both pass for the wrong reason.
    const collector = collect();
    const { heard, carrying } = await driver();

    await Promise.all([
      collector.enter(carrying('journey-one'), async () => {
        await after(5);
        vae('checkout', 'upsell', 'decided');
      }),
      collector.enter(carrying('journey-two'), async () => {
        vae('checkout', 'upsell', 'decided');
        await after(10);
        vae('checkout', 'upsell', 'shown');
      }),
    ]);

    const said = await settled(heard, 3);
    expect(said.map((one) => `${one.journey} ${one.report.action}`).sort()).toEqual([
      'journey-one decided',
      'journey-two decided',
      'journey-two shown',
    ]);
    // Order inside one execution is the property a wait rests on. Between two of
    // them there is no order to have, which is why the assertion above sorts.
    expect(
      said.filter((one) => one.journey === 'journey-two').map((one) => one.report.action),
    ).toEqual(['decided', 'shown']);
  });

  it('stays inside an execution across an await', async () => {
    const collector = collect();
    const { heard, carrying } = await driver();

    await collector.enter(carrying('journey-one'), async () => {
      await after(1);
      vae('checkout', 'upsell', 'decided');
    });

    expect((await settled(heard, 1))[0]?.journey).toBe('journey-one');
  });

  it('announces to nobody when nothing left an address', async () => {
    const collector = collect();
    const { heard } = await driver();

    collector.enter(undefined, () => vae('checkout', 'upsell', 'decided'));
    collector.enter(`${JOURNEY_COOKIE}=journey-one`, () => vae('checkout', 'upsell', 'decided'));
    vae('checkout', 'upsell', 'decided');

    await after(50);
    expect(heard).toEqual([]);
  });

  it('refuses an address that is not loopback', async () => {
    // The cookie is written by whoever is talking to the service. A process that
    // posts wherever it is told is a way to reach whatever that process can reach.
    const collector = collect();
    const { heard, carrying } = await driver();

    collector.enter(carrying('journey-one').replace('127.0.0.1', 'example.com'), () =>
      vae('checkout', 'upsell', 'decided'),
    );

    await after(50);
    expect(heard).toEqual([]);
  });

  it('carries the phase a process was bounded with', async () => {
    const collector = collect();
    const { heard, carrying } = await driver();

    collector.enter(carrying('journey-one'), () => {
      vaStart('checkout', 'payment', 'authorizing');
      vaEnd('checkout', 'payment', 'authorizing');
    });

    expect((await settled(heard, 2)).map((one) => one.report.phase)).toEqual(['start', 'end']);
  });

  it('says nothing when the driver has gone away', async () => {
    // The observer may not break the subject. A refused connection is the
    // driver's problem, and it surfaces there as a wait that times out.
    const collector = collect();
    const { carrying } = await driver();
    const header = carrying('journey-one');
    for (const wire of listening.splice(0)) await wire.close();

    await expect(
      collector.enter(header, async () => {
        vae('checkout', 'upsell', 'decided');
        await after(50);
      }),
    ).resolves.toBeUndefined();
  });

  it('gives the global back when it closes', async () => {
    const collector = collectEvents({ enabled: true, head: 'api' });
    const { heard, carrying } = await driver();
    collector.close();

    collector.enter(carrying('journey-one'), () => vae('checkout', 'upsell', 'decided'));

    await after(50);
    expect(heard).toEqual([]);
  });
});

describe('a driver the head is running inside', () => {
  it('takes the same announcement without a hop', async () => {
    // A suite that starts its server in-process configures nothing extra and
    // loses nothing: the report is a call, and the socket is never touched.
    const collector = collect();
    const { heard, wire } = await driver();
    uninstalled.push(installCarrier(wire.carrier));

    collector.enter(`${JOURNEY_COOKIE}=journey-one`, () =>
      vae('checkout', 'upsell', 'decided'),
    );

    expect((await settled(heard, 1))[0]?.journey).toBe('journey-one');
  });

  it('is preferred over an address, so a realm never talks to itself over a socket', async () => {
    const collector = collect();
    const near = await driver();
    const far = await driver();
    uninstalled.push(installCarrier(near.wire.carrier));

    collector.enter(far.carrying('journey-one'), () => vae('checkout', 'upsell', 'decided'));

    expect((await settled(near.heard, 1))[0]?.journey).toBe('journey-one');
    expect(far.heard).toEqual([]);
  });
});
