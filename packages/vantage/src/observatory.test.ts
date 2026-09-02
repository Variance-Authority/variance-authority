// The claim under test is that a watcher answers about a run it is only ever
// told about in fragments: a test that has not ended is described as running, a
// tally of unfinished work stays exact however much of the beginning was
// dropped, and everything the store forgot to stay bounded is counted rather
// than silently absent.

import { describe, expect, it } from 'vitest';
import type { RecordedEvent } from '@variance-authority/event/collect';
import { createObservatory, type Observatory } from './observatory.js';
import { VANTAGE_VERSION, type VantageReport } from './report.js';

function announced(
  ordinal: number,
  action: string,
  phase: RecordedEvent['phase'] = 'once',
  realm = 'page',
): RecordedEvent {
  return { ordinal, realm, phase, location: 'checkout', subject: 'payment', action };
}

function heard(event: RecordedEvent): VantageReport {
  return { version: VANTAGE_VERSION, kind: 'heard', event };
}

function opened(title: string, worker = 0): VantageReport {
  return {
    version: VANTAGE_VERSION,
    kind: 'opened',
    title,
    file: 'tests/checkout.spec.ts',
    worker,
  };
}

/** A watcher that has been told one test started. */
function watching(options?: Parameters<typeof createObservatory>[0]): Observatory {
  const observatory = createObservatory(options);
  observatory.took('t1', opened('checkout settles'));
  return observatory;
}

describe('createObservatory', () => {
  it('describes a test nothing has closed as running', () => {
    const observatory = watching();

    expect(observatory.snapshot().tests).toEqual([
      {
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
      },
    ]);
  });

  it('keeps announcements in the order they were announced', () => {
    const observatory = watching();
    observatory.took('t1', heard(announced(0, 'opened')));
    observatory.took('t1', heard(announced(1, 'authorizing', 'start', 'api')));

    expect(observatory.snapshot().tests[0]?.heard.map((one) => one.action)).toEqual([
      'opened',
      'authorizing',
    ]);
  });

  it('names work that started and never ended', () => {
    const observatory = watching();
    observatory.took('t1', heard(announced(0, 'authorizing', 'start', 'api')));
    observatory.took('t1', heard(announced(1, 'settling', 'start', 'api')));
    observatory.took('t1', heard(announced(2, 'settling', 'end', 'api')));

    expect(observatory.snapshot().tests[0]?.pending.map((one) => one.action)).toEqual([
      'authorizing',
    ]);
  });

  it('keeps that tally exact after the announcements themselves were dropped', () => {
    // The bound is on the listing, not on the arithmetic. A run asked what it
    // never finished is usually a long one, which is precisely the run whose
    // opening announcements are the ones a bounded store gave up.
    const observatory = watching({ heard: 2 });
    observatory.took('t1', heard(announced(0, 'authorizing', 'start', 'api')));
    observatory.took('t1', heard(announced(1, 'first')));
    observatory.took('t1', heard(announced(2, 'second')));
    observatory.took('t1', heard(announced(3, 'third')));

    const test = observatory.snapshot().tests[0];
    expect(test?.heard.map((one) => one.action)).toEqual(['second', 'third']);
    expect(test?.forgotten).toBe(2);
    expect(test?.pending.map((one) => one.action)).toEqual(['authorizing']);
  });

  it('counts the tests it dropped rather than answering as if they never ran', () => {
    const observatory = createObservatory({ tests: 2 });
    observatory.took('t1', opened('one'));
    observatory.took('t2', opened('two'));
    observatory.took('t3', opened('three'));

    const state = observatory.snapshot();
    expect(state.tests.map((one) => one.title)).toEqual(['two', 'three']);
    expect(state.forgotten).toBe(1);
  });

  it('takes the last word on a remark and not every number it passed through', () => {
    const observatory = watching();
    observatory.took('t1', { version: VANTAGE_VERSION, kind: 'remarked', about: 'api', sentence: 'once' });
    observatory.took('t1', { version: VANTAGE_VERSION, kind: 'remarked', about: 'api', sentence: 'twice' });

    expect(observatory.snapshot().tests[0]?.remarks).toEqual(['twice']);
  });

  it('carries how a test ended and what it said on the way out', () => {
    const observatory = watching();
    observatory.took('t1', {
      version: VANTAGE_VERSION,
      kind: 'closed',
      state: 'timedOut',
      error: 'nothing settled',
    });

    const test = observatory.snapshot().tests[0];
    expect(test?.state).toBe('timedOut');
    expect(test?.error).toBe('nothing settled');
  });

  it('holds what arrives for a test nothing opened, rather than dropping the evidence', () => {
    // It should not happen: reports about one test travel one endpoint in order.
    // If it does, the fragment is about the wiring somebody is here to fix.
    const observatory = createObservatory();
    observatory.took('t9', heard(announced(0, 'opened')));

    expect(observatory.snapshot().tests[0]).toMatchObject({
      id: 't9',
      title: 't9',
      worker: -1,
      heard: [expect.objectContaining({ action: 'opened' })],
    });
  });

  it('hands out a value that does not change when the run does', () => {
    const observatory = watching();
    const before = observatory.snapshot();
    observatory.took('t1', heard(announced(0, 'opened')));

    expect(before.tests[0]?.heard).toEqual([]);
    expect(observatory.snapshot().tests[0]?.heard).toHaveLength(1);
  });

  it('carries the address, so an answer with nothing in it can say what to set', () => {
    expect(createObservatory({ address: 'http://127.0.0.1:9' }).snapshot().address).toBe(
      'http://127.0.0.1:9',
    );
    expect(createObservatory().snapshot().address).toBeUndefined();
  });
});
