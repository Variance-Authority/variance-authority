// The claim under test is that a watcher hears a head as well as a run: what a
// request nobody drove entered arrives on the address a run reports to, and is
// held as one execution a reader can ask about.

import { afterEach, describe, expect, it } from 'vitest';
import { VANTAGE_ASK, attachVantage, type AttachedVantage, type VantageReading } from './attach.js';
import type { WatchedRan } from './state.js';

const attached: AttachedVantage[] = [];

async function watcher(options: { executions?: number } = {}): Promise<AttachedVantage> {
  const one = await attachVantage(options);
  attached.push(one);
  return one;
}

interface Said {
  readonly scope?: 'journey' | 'process';
  readonly head?: string;
  readonly opened?: number;
  readonly settled?: number;
  readonly lost?: number;
  readonly modules?: readonly { id: string; hits: number[]; shared: number[]; again?: number[] }[];
}

/** What a head posts: one account, on the path that names the execution. */
async function says(one: AttachedVantage, journey: string, said: Said): Promise<void> {
  const response = await fetch(`${one.address}/${encodeURIComponent(journey)}/journeys`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ version: 1, instrumentation: 'probes-1', head: 'api', scope: 'journey', modules: [], ...said }),
  });
  expect(response.ok).toBe(true);
}

async function ran(one: AttachedVantage): Promise<WatchedRan> {
  const response = await fetch(`${one.address}${VANTAGE_ASK}`);
  return ((await response.json()) as VantageReading).state.ran;
}

afterEach(async () => {
  for (const one of attached.splice(0)) await one.close();
});

describe('a watcher a head reports to', () => {
  it('holds nothing before a head has spoken', async () => {
    const one = await watcher();

    expect(await ran(one)).toEqual({ executions: [], forgotten: 0, common: [], lost: 0 });
  });

  it('holds what one execution entered, by head and module', async () => {
    const one = await watcher();
    await says(one, 'j-1', { opened: 1 });
    await says(one, 'j-1', { settled: 1, modules: [{ id: 'src/cart.ts@abc', hits: [4, 2], shared: [] }] });
    await says(one, 'j-1', { head: 'worker', modules: [{ id: 'src/mail.ts@def', hits: [1], shared: [] }] });

    expect((await ran(one)).executions).toEqual([
      {
        id: 'j-1',
        ordinal: 0,
        open: false,
        heads: [
          { head: 'api', instrumentation: 'probes-1', modules: [{ id: 'src/cart.ts@abc', entered: [2, 4] }] },
          { head: 'worker', instrumentation: 'probes-1', modules: [{ id: 'src/mail.ts@def', entered: [1] }] },
        ],
      },
    ]);
  });

  it('says an execution is still open until its scope settles', async () => {
    const one = await watcher();
    await says(one, 'j-1', { opened: 1 });

    expect((await ran(one)).executions[0]?.open).toBe(true);
  });

  it('keeps two executions apart, in the order they arrived', async () => {
    const one = await watcher();
    await says(one, 'j-1', { modules: [{ id: 'src/cart.ts@abc', hits: [1], shared: [] }] });
    await says(one, 'j-2', { modules: [{ id: 'src/cart.ts@abc', hits: [2], shared: [] }] });
    await says(one, 'j-1', { modules: [{ id: 'src/cart.ts@abc', hits: [3], shared: [] }] });

    const { executions } = await ran(one);
    expect(executions.map((execution) => [execution.id, execution.heads[0]?.modules[0]?.entered])).toEqual([
      ['j-1', [1, 3]],
      ['j-2', [2]],
    ]);
  });

  it('lists apart what the process entered for every execution', async () => {
    const one = await watcher();
    // What an execution entered while a module evaluated is every execution's:
    // the head says it again as the process's, so it is not held twice.
    await says(one, 'j-1', { modules: [{ id: 'src/cart.ts@abc', hits: [0, 1, 5], shared: [0, 1], again: [1] }] });
    await says(one, 'j-1', { scope: 'process', modules: [{ id: 'src/cart.ts@abc', hits: [0, 1], shared: [] }] });

    const held = await ran(one);
    expect(held.executions[0]?.heads[0]?.modules).toEqual([{ id: 'src/cart.ts@abc', entered: [1, 5] }]);
    expect(held.common).toEqual([
      { head: 'api', instrumentation: 'probes-1', modules: [{ id: 'src/cart.ts@abc', entered: [0, 1] }] },
    ]);
    expect(held.executions.length).toBe(1);
  });

  it('drops the oldest execution past its bound, and counts it', async () => {
    const one = await watcher({ executions: 2 });
    for (const journey of ['j-1', 'j-2', 'j-3']) await says(one, journey, { opened: 1 });

    const held = await ran(one);
    expect(held.executions.map((execution) => execution.id)).toEqual(['j-2', 'j-3']);
    expect(held.forgotten).toBe(1);
  });

  it('carries how many accounts each head said it lost', async () => {
    const one = await watcher();
    await says(one, 'j-1', { lost: 2 });
    await says(one, 'j-2', { lost: 3 });
    await says(one, 'j-2', { head: 'worker', lost: 1 });

    expect((await ran(one)).lost).toBe(4);
  });

  it('takes nothing from a body that is not an account', async () => {
    const one = await watcher();
    await fetch(`${one.address}/j-1/journeys`, { method: 'POST', body: JSON.stringify({ version: 2, head: 'api' }) });

    expect((await ran(one)).executions).toEqual([]);
  });
});
