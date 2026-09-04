// The claim under test is that a watcher can be *asked* — that the address a run
// reports to is also the address a reader reads from, and that the state a live
// `diff` compares against is held here, by the process that outlives the
// question, rather than by the one-shot command that asked it.

import { afterEach, describe, expect, it } from 'vitest';
import { VANTAGE_ASK, attachVantage, type AttachedVantage, type VantageReading } from './attach.js';
import { VANTAGE_VERSION } from './report.js';

const attached: AttachedVantage[] = [];

async function watcher(): Promise<AttachedVantage> {
  const one = await attachVantage();
  attached.push(one);
  return one;
}

function opened(one: AttachedVantage, test: string, title: string): void {
  one.observatory.took(test, { version: VANTAGE_VERSION, kind: 'opened', title, file: 'a.spec.ts', worker: 0 });
}

async function read(one: AttachedVantage): Promise<VantageReading> {
  const response = await fetch(`${one.address}${VANTAGE_ASK}`);
  expect(response.status).toBe(200);
  return (await response.json()) as VantageReading;
}

afterEach(async () => {
  for (const one of attached.splice(0)) await one.close();
});

describe('a watcher that can be asked', () => {
  it('answers on the origin a run reports to, so there is one address to pass around', async () => {
    const one = await watcher();

    expect((await read(one)).state.address).toBe(one.address);
  });

  it('answers before any run has reported, because that is a question too', async () => {
    // A reader that had to wait for a run to start could not tell an idle watcher
    // from a broken one, which is the moment it most needs to know.
    const one = await watcher();

    expect((await read(one)).state.tests).toEqual([]);
  });

  it('hands out what the observatory holds at the moment of asking', async () => {
    const one = await watcher();
    opened(one, 't-1', 'checkout settles');

    const reading = await read(one);

    expect(reading.state.tests.map((test) => test.title)).toEqual(['checkout settles']);
  });

  it('holds the previous reading, which is the state a live diff compares against', async () => {
    // The reader is a process that exits. It cannot hold this and it cannot come
    // back to say it succeeded, so the watcher rotates on handing a reading over.
    const one = await watcher();

    expect((await read(one)).previous).toBeUndefined();

    opened(one, 't-1', 'checkout settles');
    const second = await read(one);

    expect(second.previous?.tests).toEqual([]);
    expect(second.state.tests.length).toBe(1);
  });

  it('has nothing for a path it does not answer', async () => {
    const one = await watcher();

    expect((await fetch(`${one.address}/somewhere-else`)).status).toBe(404);
  });

  it('still takes reports on the address it answers on', async () => {
    // Reading is a GET and reporting is a POST, so neither surface can take the
    // other's traffic no matter what an execution id happens to spell.
    const one = await watcher();
    opened(one, 't-1', 'checkout settles');
    await read(one);
    one.observatory.took('t-1', { version: VANTAGE_VERSION, kind: 'closed', state: 'passed' });

    expect((await read(one)).state.tests[0]?.state).toBe('passed');
  });
});
