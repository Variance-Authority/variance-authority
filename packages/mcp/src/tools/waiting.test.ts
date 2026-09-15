import { describe, expect, it } from 'vitest';
import type { VantageState, WatchedTest } from '@variance-authority/vantage';
import { continuing, type Releasing } from './continue.js';
import { waiting } from './waiting.js';

function test(over: Partial<WatchedTest> = {}): WatchedTest {
  return {
    id: 't1',
    title: 'checkout settles',
    file: 'tests/checkout.spec.ts',
    worker: 0,
    ordinal: 0,
    state: 'running',
    heard: [],
    forgotten: 0,
    pending: [],
    remarks: [],
    notes: [],
    forgottenNotes: 0,
    ...over,
  };
}

function state(...tests: WatchedTest[]): VantageState {
  return { address: 'http://127.0.0.1:53411', forgotten: 0, tests };
}

const STOPPED = test({
  waitingAt: 'tests/checkout.spec.ts:24:7',
  notes: [{ at: 'tests/checkout.spec.ts:19:5', note: 'card declined once', ordinal: 0 }],
});

describe('variance_waiting', () => {
  it('names each stopped test, where it stopped, and what it sent', () => {
    const said = waiting.run(state(STOPPED, test({ id: 't2', title: 'cart empties' })), {});

    expect(said).toContain('1 test(s) are waiting');
    expect(said).toContain('tests/checkout.spec.ts:24:7');
    expect(said).toContain('card declined once');
    expect(said).toContain('variance_continue');
    // The test that is merely running is not offered as something to release.
    expect(said).not.toContain('cart empties');
  });

  it('says nothing is stopped without reading as a broken tool', () => {
    // A reader told only "none" concludes the feature does not work. The answer
    // has to carry why a suite with the call in it can still be silent here.
    const said = waiting.run(state(test()), {});

    expect(said).toContain('Nothing is waiting');
    expect(said).toContain('await variance.observe()');
    expect(said).toContain('inert when nobody is watching');
  });

  it('sends a reader to the environment variable when nothing has reported', () => {
    expect(waiting.run(state(), {})).toContain('VARIANCE_AUTHORITY_VANTAGE=');
  });
});

/** A release that remembers what it was asked, and what it was willing to do. */
function releasing(willing: boolean): Releasing & { readonly asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    release: (one) => {
      asked.push(one);
      return willing;
    },
    releaseAll: () => (willing ? ['t1'] : []),
  };
}

describe('variance_continue', () => {
  it('releases the test it was given, and says where it was stopped', () => {
    const release = releasing(true);

    const said = continuing(release).run(state(STOPPED), { test: 't1' });

    expect(release.asked).toEqual(['t1']);
    expect(said).toContain('Released checkout settles [t1]');
    expect(said).toContain('tests/checkout.spec.ts:24:7');
  });

  it('releases everything when given nothing', () => {
    const said = continuing(releasing(true)).run(state(STOPPED), {});

    expect(said).toContain('Released 1 test(s): t1.');
  });

  it('says so rather than succeeding quietly when a test is not stopped', () => {
    // Both ways this happens — never stopped, already let go — mean the reader
    // is acting on a listing older than the run.
    const said = continuing(releasing(false)).run(state(test({ state: 'passed' })), { test: 't1' });

    expect(said).toContain('is not waiting');
    expect(said).toContain('passed');
  });

  it('points an unknown id back at the tool that prints them', () => {
    const said = continuing(releasing(true)).run(state(STOPPED), { test: 'nope' });

    expect(said).toContain('variance_waiting');
  });

  it('refuses an argument that is not a test id', () => {
    expect(() => continuing(releasing(true)).run(state(STOPPED), { test: 7 })).toThrow(
      '`test` must be a non-empty string',
    );
  });
});
