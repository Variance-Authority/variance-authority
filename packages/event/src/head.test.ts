// The claim under test is that a process serving several executions at once
// answers each announcement to the driver that asked for it, in the order it
// said them, that a process nobody configured says nothing at all, and that the
// whole channel is a socket held open for the length of a run: no file is opened
// anywhere in here, and none is left behind.

import { setTimeout as after } from 'node:timers/promises';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EVENT_COOKIE,
  EVENT_HEAD_VARIABLE,
  EVENT_VARIABLE,
  collectEvents,
  type EventCollector,
  type HeadEventReport,
} from './head.js';
import { receiveEvents, type EventReceiver } from './receive.js';
import { vae, vaEnd, vaStart } from './index.js';

interface Heard {
  readonly journey: string;
  readonly report: HeadEventReport;
}

const opened: EventCollector[] = [];
const listening: EventReceiver[] = [];

/** A driver listening on loopback, and everything it has been told so far. */
async function driver(): Promise<{
  heard: Heard[];
  endpointFor: (journey: string) => string;
}> {
  const heard: Heard[] = [];
  const receiver = await receiveEvents((journey, report) => heard.push({ journey, report }));
  listening.push(receiver);
  return { heard, endpointFor: receiver.endpointFor };
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
  for (const collector of opened.splice(0)) collector.close();
  for (const receiver of listening.splice(0)) await receiver.close();
  delete process.env[EVENT_VARIABLE];
  delete process.env[EVENT_HEAD_VARIABLE];
});

describe('collectEvents', () => {
  it('installs nothing when nothing says this process is under a run', () => {
    const collector = collectEvents({ head: 'api' });
    expect(collector.collecting).toBe(false);
    expect(
      collector.enter('http://127.0.0.1:1/a-journey', () => vae('checkout', 'upsell', 'decided')),
    ).toBeUndefined();
  });

  it('reads the run and the head from the environment', async () => {
    process.env[EVENT_VARIABLE] = '1';
    process.env[EVENT_HEAD_VARIABLE] = 'pricing';
    const collector = collectEvents();
    opened.push(collector);
    const { heard, endpointFor } = await driver();

    expect(collector.head).toBe('pricing');
    collector.enter(endpointFor('a-journey'), () => vae('checkout', 'upsell', 'decided'));

    expect((await settled(heard, 1))[0]?.report.head).toBe('pricing');
  });

  it('answers the driver that owns the execution it was serving', async () => {
    const collector = collect();
    const { heard, endpointFor } = await driver();

    collector.enter(endpointFor('journey-one'), () => vae('checkout', 'upsell', 'decided'));

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

  it('takes the address off the cookie the request already carried', async () => {
    const collector = collect();
    const { heard, endpointFor } = await driver();
    const header = `session=abc; ${EVENT_COOKIE}=${endpointFor('journey-one')}; theme=dark`;

    collector.enter(header, () => vae('checkout', 'upsell', 'decided'));

    expect((await settled(heard, 1))[0]?.journey).toBe('journey-one');
  });

  it('keeps two concurrent executions apart', async () => {
    // The reason an execution is on the wire at all: without it, one test's wait
    // is satisfied by another test's decision and both pass for the wrong reason.
    const collector = collect();
    const { heard, endpointFor } = await driver();

    await Promise.all([
      collector.enter(endpointFor('journey-one'), async () => {
        await after(5);
        vae('checkout', 'upsell', 'decided');
      }),
      collector.enter(endpointFor('journey-two'), async () => {
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
    const { heard, endpointFor } = await driver();

    await collector.enter(endpointFor('journey-one'), async () => {
      await after(1);
      vae('checkout', 'upsell', 'decided');
    });

    expect((await settled(heard, 1))[0]?.journey).toBe('journey-one');
  });

  it('announces to nobody when nothing left an address', async () => {
    const collector = collect();
    const { heard } = await driver();

    collector.enter(undefined, () => vae('checkout', 'upsell', 'decided'));
    vae('checkout', 'upsell', 'decided');

    await after(50);
    expect(heard).toEqual([]);
  });

  it('refuses an address that is not loopback', async () => {
    // The cookie is written by whoever is talking to the service. A process that
    // posts wherever it is told is a way to reach whatever that process can reach.
    const collector = collect();
    const { heard, endpointFor } = await driver();

    collector.enter(endpointFor('journey-one').replace('127.0.0.1', 'example.com'), () =>
      vae('checkout', 'upsell', 'decided'),
    );

    await after(50);
    expect(heard).toEqual([]);
  });

  it('carries the phase a process was bounded with', async () => {
    const collector = collect();
    const { heard, endpointFor } = await driver();

    collector.enter(endpointFor('journey-one'), () => {
      vaStart('checkout', 'payment', 'authorizing');
      vaEnd('checkout', 'payment', 'authorizing');
    });

    expect((await settled(heard, 2)).map((one) => one.report.phase)).toEqual(['start', 'end']);
  });

  it('says nothing when the driver has gone away', async () => {
    // The observer may not break the subject. A refused connection is the
    // driver's problem, and it surfaces there as a wait that times out.
    const collector = collect();
    const { endpointFor } = await driver();
    const endpoint = endpointFor('journey-one');
    for (const receiver of listening.splice(0)) await receiver.close();

    await expect(
      collector.enter(endpoint, async () => {
        vae('checkout', 'upsell', 'decided');
        await after(50);
      }),
    ).resolves.toBeUndefined();
  });

  it('gives the global back when it closes', async () => {
    const collector = collectEvents({ enabled: true, head: 'api' });
    const { heard, endpointFor } = await driver();
    collector.close();

    collector.enter(endpointFor('journey-one'), () => vae('checkout', 'upsell', 'decided'));

    await after(50);
    expect(heard).toEqual([]);
  });
});

describe('receiveEvents', () => {
  it('hands out one address per execution', async () => {
    const { endpointFor } = await driver();
    expect(endpointFor('journey-one')).not.toBe(endpointFor('journey-two'));
    expect(endpointFor('journey-one')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/journey-one$/);
  });

  it('reads back an execution whose id would not survive a path', async () => {
    const collector = collect();
    const { heard, endpointFor } = await driver();

    collector.enter(endpointFor('a/b c'), () => vae('checkout', 'upsell', 'decided'));

    expect((await settled(heard, 1))[0]?.journey).toBe('a/b c');
  });

  it('drops a body it cannot read rather than losing the run', async () => {
    const { heard, endpointFor } = await driver();

    await fetch(endpointFor('journey-one'), { method: 'POST', body: 'from a later version' });

    await after(50);
    expect(heard).toEqual([]);
  });

  it('stops answering when it closes', async () => {
    const receiver = await receiveEvents(() => {});
    const endpoint = receiver.endpointFor('journey-one');
    await receiver.close();

    await expect(fetch(endpoint, { method: 'POST', body: '{}' })).rejects.toThrow();
  });
});
