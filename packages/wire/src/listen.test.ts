// The claim under test is that the driver's end reads an execution off the
// address it minted rather than out of a body it was handed, that it answers a
// participant honestly enough for one to know it lost a report, and that a
// listener holds nothing open once the run it belonged to is over.

import { afterEach, describe, expect, it } from 'vitest';
import { WIRE_SINK } from './index.js';
import { listen, wireCarrierSource, WIRE_REPORT, type Wire } from './listen.js';

const listening: Wire[] = [];

afterEach(async () => {
  for (const wire of listening.splice(0)) await wire.close();
});

async function open(): Promise<Wire> {
  const wire = await listen();
  listening.push(wire);
  return wire;
}

describe('listen', () => {
  it('hands out one address per execution, on loopback', async () => {
    const wire = await open();
    expect(wire.addressFor('journey-one')).not.toBe(wire.addressFor('journey-two'));
    expect(wire.addressFor('journey-one')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/journey-one$/);
  });

  it('reads back an execution whose id would not survive a path', async () => {
    const wire = await open();
    const taken: (string | undefined)[] = [];
    wire.on('events', (journey) => taken.push(journey));

    const response = await fetch(`${wire.addressFor('a/b c')}/events`, {
      method: 'POST',
      body: '{}',
    });

    expect(response.status).toBe(204);
    expect(taken).toEqual(['a/b c']);
  });

  it('refuses a body it cannot read rather than losing the run', async () => {
    const wire = await open();
    const taken: unknown[] = [];
    wire.on('journeys', (_journey, body) => taken.push(body));

    const response = await fetch(`${wire.addressFor('journey-one')}/journeys`, {
      method: 'POST',
      body: 'from a later version',
    });

    // A refusal rather than a crash, because whoever sent it is the subject and
    // an acknowledged report that cannot be read is one the sender must be told
    // about.
    expect(response.status).toBe(404);
    expect(taken).toEqual([]);
  });

  it('refuses an instrument nothing here is listening for', async () => {
    const wire = await open();
    const response = await fetch(`${wire.addressFor('journey-one')}/journeys`, {
      method: 'POST',
      body: '{}',
    });
    expect(response.status).toBe(404);
  });

  it('gives one instrument up without taking the other down', async () => {
    const wire = await open();
    const taken: unknown[] = [];
    const give = wire.on('events', (_journey, body) => taken.push(body));
    wire.on('journeys', (_journey, body) => taken.push(body));
    give();

    const announced = await fetch(`${wire.addressFor('journey-one')}/events`, {
      method: 'POST',
      body: '{}',
    });
    const accounted = await fetch(`${wire.addressFor('journey-one')}/journeys`, {
      method: 'POST',
      body: '{}',
    });

    expect([announced.status, accounted.status]).toEqual([404, 204]);
  });

  it('stops answering when it closes', async () => {
    const wire = await listen();
    const address = wire.addressFor('journey-one');
    await wire.close();

    await expect(fetch(`${address}/events`, { method: 'POST', body: '{}' })).rejects.toThrow();
  });
});

describe('wireCarrierSource', () => {
  it('is source a realm with no module graph can evaluate', () => {
    const source = wireCarrierSource();
    expect(source).not.toContain('import ');
    expect(source).not.toContain('require(');
    expect(source).toContain(WIRE_SINK);
    expect(source).toContain(WIRE_REPORT);
  });
});

describe('a listener that answers', () => {
  it('says nothing to a reader unless one was asked for', async () => {
    // Opt-in, and this is why: a head and an event collector listen on the same
    // medium, and neither has anything it means to publish. Making the read
    // general would have given every one of them a reader it never agreed to.
    const wire = await open();

    expect((await fetch(`${wire.origin}/`)).status).toBe(404);
  });

  it('answers a reader on the same origin a run reports to', async () => {
    // One address, not two. The string an agent exported for the suite is the
    // string it asks on, so there is nothing to keep in step.
    const wire = await listen({ answer: (path) => (path === '/' ? { held: 2 } : undefined) });
    listening.push(wire);

    const response = await fetch(`${wire.origin}/`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual({ held: 2 });
  });

  it('refuses a path it has nothing for, rather than answering about another', async () => {
    const wire = await listen({ answer: (path) => (path === '/' ? {} : undefined) });
    listening.push(wire);

    expect((await fetch(`${wire.origin}/elsewhere`)).status).toBe(404);
  });

  it('keeps reading separate from reporting, so an execution id cannot collide', async () => {
    // Separated by method rather than by path. A participant reports under an
    // execution id it chose, and `/` is a perfectly good one.
    const wire = await listen({ answer: () => ({ read: true }) });
    listening.push(wire);
    const taken: (string | undefined)[] = [];
    wire.on('events', (journey) => taken.push(journey));

    const posted = await fetch(`${wire.addressFor('/')}/events`, { method: 'POST', body: '{}' });

    expect(posted.status).toBe(204);
    expect(taken).toEqual(['/']);
    expect(await (await fetch(`${wire.origin}/`)).json()).toEqual({ read: true });
  });
});
