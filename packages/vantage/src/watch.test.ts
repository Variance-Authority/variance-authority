// The claim under test is that the two halves reach each other over a real
// socket, that a run told nothing installs nothing and costs nothing, and that a
// watcher which has gone away is a run that carries on — the observer may not
// break the subject, and this is the file that would find out if it did.

import { setTimeout as after } from 'node:timers/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { attachVantage, type AttachedVantage } from './attach.js';
import { VANTAGE_VARIABLE, openVantage } from './watch.js';

const attached: AttachedVantage[] = [];

async function watcher(): Promise<AttachedVantage> {
  const one = await attachVantage();
  attached.push(one);
  return one;
}

/** What the watcher holds, once as much as was promised has arrived. */
async function settled(one: AttachedVantage, tests: number): Promise<void> {
  await expect.poll(() => one.observatory.snapshot().tests.length).toBe(tests);
}

afterEach(async () => {
  for (const one of attached.splice(0)) await one.close();
  delete process.env[VANTAGE_VARIABLE];
});

describe('openVantage', () => {
  it('reports nothing when nothing says anybody is watching', () => {
    expect(openVantage(undefined)).toBeUndefined();
    expect(openVantage('')).toBeUndefined();
  });

  it('reads the address from the environment', async () => {
    const one = await watcher();
    process.env[VANTAGE_VARIABLE] = one.address;

    openVantage()?.opened('t1', { title: 'checkout settles', file: 'a.spec.ts', worker: 0 });

    await settled(one, 1);
  });

  it('refuses an address that is not loopback', () => {
    // The variable is read from an environment this process did not necessarily
    // write, and a reporter that posts wherever it is told is a way to reach
    // whatever the run can reach.
    expect(openVantage('http://example.com:8080')).toBeUndefined();
    expect(openVantage('https://127.0.0.1:8080')).toBeUndefined();
    expect(openVantage('not a url')).toBeUndefined();
  });

  it('carries one test from the run to the watcher, whole', async () => {
    const one = await watcher();
    const vantage = openVantage(one.address);

    vantage?.opened('t1', {
      title: 'checkout settles',
      file: 'tests/checkout.spec.ts',
      project: 'chromium',
      worker: 2,
    });
    vantage?.heard('t1', {
      ordinal: 0,
      realm: 'api',
      phase: 'start',
      location: 'checkout',
      subject: 'payment',
      action: 'authorizing',
    });
    vantage?.remarked('t1', 'pricing', 'answered for an execution no test here owns');
    vantage?.closed('t1', 'timedOut', 'nothing settled');

    await settled(one, 1);
    await expect.poll(() => one.observatory.snapshot().tests[0]?.state).toBe('timedOut');
    expect(one.observatory.snapshot().tests[0]).toMatchObject({
      title: 'checkout settles',
      file: 'tests/checkout.spec.ts',
      project: 'chromium',
      worker: 2,
      state: 'timedOut',
      error: 'nothing settled',
      remarks: ['answered for an execution no test here owns'],
      pending: [expect.objectContaining({ action: 'authorizing' })],
    });
  });

  it('keeps one test’s announcements in order', async () => {
    // The one property a reading of a hung test rests on. Reports about one test
    // travel one endpoint, which is what keeps them in order without a clock.
    const one = await watcher();
    const vantage = openVantage(one.address);
    vantage?.opened('t1', { title: 'a', file: 'a.spec.ts', worker: 0 });

    for (const [ordinal, action] of ['first', 'second', 'third'].entries()) {
      vantage?.heard('t1', {
        ordinal,
        realm: 'page',
        phase: 'once',
        location: 'checkout',
        subject: 'cart',
        action,
      });
    }

    await expect
      .poll(() => one.observatory.snapshot().tests[0]?.heard.map((event) => event.action))
      .toEqual(['first', 'second', 'third']);
  });

  it('keeps two tests apart', async () => {
    const one = await watcher();
    const vantage = openVantage(one.address);
    vantage?.opened('t1', { title: 'one', file: 'a.spec.ts', worker: 0 });
    vantage?.opened('t2', { title: 'two', file: 'b.spec.ts', worker: 1 });

    await settled(one, 2);
    expect(one.observatory.snapshot().tests.map((test) => test.title)).toEqual(['one', 'two']);
  });

  it('carries on when the watcher has gone away', async () => {
    const one = await watcher();
    const vantage = openVantage(one.address);
    await one.close();
    attached.splice(0);

    expect(() => vantage?.opened('t1', { title: 'a', file: 'a.spec.ts', worker: 0 })).not.toThrow();
    await after(50);
  });
});
