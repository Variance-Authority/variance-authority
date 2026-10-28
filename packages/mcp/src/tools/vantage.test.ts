import { describe, expect, it } from 'vitest';
import type {
  RecordedEvent,
  VantageState,
  WatchedTest,
} from '@variance-authority/vantage';
import { handle, REPORTS, VANTAGE } from '../protocol.js';
import { runSignals } from './run-signals.js';
import { self } from './self.js';
import { testSignals } from './test-signals.js';

function event(ordinal: number, realm: string, action: string, phase = 'once'): RecordedEvent {
  return {
    ordinal,
    realm,
    phase: phase as RecordedEvent['phase'],
    location: 'checkout',
    subject: 'payment',
    action,
  };
}

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

const ADDRESS = 'http://127.0.0.1:53411';

const RUNNING: VantageState = {
  address: ADDRESS,
  forgotten: 0,
  tests: [
    test({
      id: 'passed-one',
      title: 'cart is empty at first',
      file: 'tests/cart.spec.ts',
      state: 'passed',
      heard: [event(0, 'page', 'opened')],
    }),
    test({
      heard: [event(0, 'page', 'opened'), event(1, 'api', 'authorizing', 'start')],
      pending: [event(1, 'api', 'authorizing', 'start')],
      ordinal: 1,
      worker: 1,
    }),
  ],
};

describe('variance_run_signals', () => {
  it('is callable through the MCP protocol, beside the tools that read a report', () => {
    const listed = handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, () => RUNNING, VANTAGE);
    expect((listed!.result as { tools: { name: string }[] }).tools).toEqual([
      expect.objectContaining({ name: 'variance_self' }),
      expect.objectContaining({ name: 'variance_run_signals' }),
      expect.objectContaining({ name: 'variance_waiting' }),
      expect.objectContaining({ name: 'variance_test_signals' }),
      expect.objectContaining({ name: 'variance_diff' }),
    ]);
  });

  it('lists what the suite is doing, running tests marked', () => {
    const text = runSignals.run(RUNNING, {});
    expect(text).toContain('2 test(s) at http://127.0.0.1:53411');
    expect(text).toContain('▸ running');
    expect(text).toContain('checkout settles — tests/checkout.spec.ts — worker 1 — heard 2, pending 1');
  });

  it('says what to set when nothing has reported, and says the address itself', () => {
    // The empty answer decides whether this is ever used: a reader told only
    // "no tests" concludes the suite has none, or that the tool is broken.
    const text = runSignals.run({ address: ADDRESS, tests: [], forgotten: 0 }, {});
    expect(text).toContain(`VARIANCE_AUTHORITY_VANTAGE=${ADDRESS}`);
    expect(text).toContain('takes no screenshot');
  });

  it('narrows by state and by file, and says what there is when nothing matches', () => {
    expect(runSignals.run(RUNNING, { state: 'passed' })).toContain('cart is empty at first');
    expect(runSignals.run(RUNNING, { state: 'passed' })).not.toContain('checkout settles');
    expect(runSignals.run(RUNNING, { file: 'tests/cart.spec.ts' })).toContain('cart is empty at first');

    const none = runSignals.run(RUNNING, { state: 'skipped' });
    expect(none).toContain('No test here matches state skipped');
    expect(none).toContain('passed, running');
  });

  it('narrows to the one file named, never to a file whose name contains it', () => {
    // Two names are two files. A substring took `tests/cart.spec.tsx` with
    // `tests/cart.spec.ts`, and `cart` with both, and an agent reading the
    // listing cannot see that a second file answered.
    const two: VantageState = {
      forgotten: 0,
      tests: [
        test({ id: 'ts', title: 'cart adds', file: 'tests/cart.spec.ts' }),
        test({ id: 'tsx', title: 'cart renders', file: 'tests/cart.spec.tsx' }),
      ],
    };

    const exact = runSignals.run(two, { file: 'tests/cart.spec.ts' });
    expect(exact).toContain('cart adds');
    expect(exact).not.toContain('cart renders');

    const part = runSignals.run(two, { file: 'cart' });
    expect(part).toContain('No test here matches file cart.');
    expect(part).not.toContain('cart adds');
  });

  it('reads the file the way the record spells it, from the checkout it was given', () => {
    const root = '/work/shop';
    for (const asked of ['./tests/cart.spec.ts', 'tests/../tests/cart.spec.ts', '/work/shop/tests/cart.spec.ts']) {
      const text = runSignals.run(RUNNING, { file: asked }, { root });
      expect(text).toContain('cart is empty at first');
      expect(text).not.toContain('checkout settles');
    }

    const none = runSignals.run(RUNNING, { file: './tests/gone.spec.ts' }, { root });
    expect(none).toContain('No test here matches file tests/gone.spec.ts.');
  });

  it('refuses a file outside the checkout rather than answering that nothing matched', () => {
    expect(() => runSignals.run(RUNNING, { file: '/elsewhere/cart.spec.ts' }, { root: '/work/shop' })).toThrow(
      '/elsewhere/cart.spec.ts is outside the checkout at /work/shop, and the suite running there reports only files inside it.',
    );
  });

  it('refuses an argument a model made up', () => {
    expect(() => runSignals.run(RUNNING, { state: 'flaky' })).toThrow(/`state` must be one of/);
    expect(() => runSignals.run(RUNNING, { limit: 0 })).toThrow('`limit` takes a whole number of rows, at least 1; it was given `0`.');
  });

  it('counts what it elided rather than answering as if there were no more', () => {
    const text = runSignals.run(RUNNING, { limit: 1 });
    expect(text).toContain('checkout settles');
    expect(text).toContain('1 earlier match(es) not listed; a higher `limit` lists them.');
  });

  it('names `limit` as a shell takes it when a shell asked', () => {
    const text = runSignals.run(RUNNING, { limit: '1' }, { shell: 'variance ask' });
    expect(text).toContain('1 earlier match(es) not listed; a higher `--limit` lists them.');
    expect(() => runSignals.run(RUNNING, { limit: '0' }, { shell: 'variance ask' })).toThrow(/^`--limit` takes a whole number/);
  });
});

describe('variance_test_signals', () => {
  it('reads one test back in the order it was announced, with the realm that said each', () => {
    const text = testSignals.run(RUNNING, { test: 'checkout settles' });
    expect(text).toContain('checkout settles — tests/checkout.spec.ts — worker 1 — running');
    expect(text).toContain('page  checkout / payment / opened');
    expect(text).toContain('api  checkout / payment / authorizing (start)');
    expect(text).toContain('Started and never ended:');
    expect(text).toContain('Still running');
  });

  it('takes an id or a whole title, never a part of one', () => {
    for (const asked of ['t1', 'checkout settles']) {
      expect(testSignals.run(RUNNING, { test: asked })).toContain('checkout settles —');
    }
    for (const asked of ['settles', 'Checkout settles', 't']) {
      const text = testSignals.run(RUNNING, { test: asked });
      expect(text).toContain(`No test here has the id or title ${asked}.`);
      expect(text).toContain('  checkout settles [t1]');
    }
  });

  it('asks for an id when two tests share a whole title', () => {
    const two: VantageState = {
      forgotten: 0,
      tests: [test({ id: 'a', title: 'cart adds' }), test({ id: 'b', title: 'cart adds' })],
    };
    const text = testSignals.run(two, { test: 'cart adds' });
    expect(text).toContain('2 tests are titled cart adds');
    expect(text).toContain('[a]');
    expect(text).toContain('[b]');
  });

  it('separates a test with no listener from one that heard nothing yet', () => {
    // The distinction a timeout cannot draw from outside the worker, and the one
    // that decides whether somebody goes looking for a missing `vae` call.
    const text = testSignals.run(
      { forgotten: 0, tests: [test({ heard: [] })] },
      { test: 't1' },
    );
    expect(text).toContain('Nothing has been announced in this execution');
    expect(text).toContain('does not call `vae` yet');
  });

  it('says that a listing was trimmed rather than presenting it as the whole', () => {
    const text = testSignals.run(
      { forgotten: 0, tests: [test({ heard: [event(9, 'page', 'late')], forgotten: 9 })] },
      { test: 't1' },
    );
    expect(text).toContain('the first 9 were dropped');
  });

  it('carries how a test ended', () => {
    const text = testSignals.run(
      {
        forgotten: 0,
        tests: [test({ state: 'timedOut', error: '`checkout / payment / settled` was never announced' })],
      },
      { test: 't1' },
    );
    expect(text).toContain('Ended: timedOut.');
    expect(text).toContain('was never announced');
  });

  it('names what has reported when the test asked for has not', () => {
    const text = testSignals.run(RUNNING, { test: 'nothing like this' });
    expect(text).toContain('No test here has the id or title nothing like this');
    expect(text).toContain('[passed-one]');
  });
});

describe('the handshake', () => {
  const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize' } as const;

  it('tells an agent how to attach before it has called anything', () => {
    // The failure this prevents is the whole capability going unused. A tool
    // list describes tools; it cannot say that this one needs a run started a
    // particular way, and the address is on stderr where no model reads it.
    const state: VantageState = { address: 'http://127.0.0.1:54321', tests: [], forgotten: 0 };

    const answer = handle(initialize, () => state, VANTAGE);

    const instructions = (answer?.result as { instructions?: string } | undefined)?.instructions;
    expect(instructions).toContain('VARIANCE_AUTHORITY_VANTAGE=http://127.0.0.1:54321');
    expect(instructions).toContain('variance_self');
  });

  it('routes a retained report to its producer at the handshake', () => {
    const answer = handle(initialize, () => ({}) as never, REPORTS);

    const instructions = (answer?.result as { instructions?: string } | undefined)?.instructions;
    expect(instructions).toContain('`variance run`');
    expect(instructions).toContain('https://variance-authority.dev/start/cli');
  });
});

describe('variance_self', () => {
  it('is offered first, because it is the question asked before the others', () => {
    // A reader that has just found a watcher has no handshake to look at. Every
    // other live answer is about the run; this one is about the thing holding it.
    expect(VANTAGE.tools[0]).toBe(self);
  });

  it('says what it is holding, most of it first', () => {
    expect(self.run(RUNNING, {})).toContain('Watching 2 test(s): 1 passed, 1 running.');
  });

  it('says what to start a suite with, so the address is never guessed at', () => {
    expect(self.run(RUNNING, {})).toContain(`VARIANCE_AUTHORITY_VANTAGE=${ADDRESS}`);
  });

  it('distinguishes a watcher nothing has reported to from a suite with no tests', () => {
    // The two are indistinguishable from any other answer, and they need opposite
    // things done about them: start the suite, or start it with the variable set.
    const text = self.run({ address: ADDRESS, tests: [], forgotten: 0 }, {});

    expect(text).toContain(ADDRESS);
    expect(text).not.toContain('Watching 0 test(s)');
  });

  it('admits what it dropped, rather than reporting a shorter run', () => {
    const text = self.run({ ...RUNNING, forgotten: 12 }, {});

    expect(text).toContain('12 earlier test(s) were dropped');
  });
});
