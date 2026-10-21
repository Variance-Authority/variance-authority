import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listenForPreconditions, type PreconditionStanding } from './precondition-listener.js';
import { variancePrecondition } from './precondition.js';

const PRECONDITION = Symbol.for('variance-authority.test-selection.precondition');
const realm = globalThis as { [PRECONDITION]?: unknown };
const ROOT = resolve(import.meta.dirname, '../../../..');
const SITE = /^packages\/sense\/src\/test-selection\/precondition-listener\.test\.ts:\d+$/;

// What a listener hands over for a case: every item it said, unresolved, in the order the addon stores them.
const taken = (listener: { take(key: string): string | undefined }, key: string): unknown[] => JSON.parse(listener.take(key) ?? '[]') as unknown[];

// The suite may itself run under a recording, which installed its own recorder.
let recording: unknown;
beforeEach(() => {
  recording = realm[PRECONDITION];
  delete realm[PRECONDITION];
});
afterEach(() => {
  if (recording === undefined) delete realm[PRECONDITION];
  else realm[PRECONDITION] = recording;
  vi.restoreAllMocks();
});

describe('a realm whose runner places each call itself', () => {
  it('lays a call made in the case body on that case, at the body level', () => {
    let standing: PreconditionStanding = { at: 'case', key: 'pays' };
    const listener = listenForPreconditions(ROOT, () => standing);

    variancePrecondition({ network: 'mocked' });
    standing = { at: 'beforeEach', key: 'refunds', depth: 1 };
    variancePrecondition({ seeded: true });
    listener.close();

    expect(taken(listener, 'pays')).toEqual([['network', 'mocked', expect.stringMatching(SITE), 0xffff]]);
    expect(taken(listener, 'refunds')).toEqual([['seeded', true, expect.stringMatching(SITE), 1]]);
    expect(taken(listener, 'pays')).toEqual([]);
  });

  it('shows a running case what it has said so far, resolved, without taking it', () => {
    let standing: PreconditionStanding = { at: 'beforeEach', key: 'pays', depth: 0 };
    const listener = listenForPreconditions(ROOT, () => standing);

    variancePrecondition({ network: 'live', seeded: true });
    standing = { at: 'case', key: 'pays' };
    variancePrecondition({ network: 'mocked' });
    const held = listener.held('pays');
    variancePrecondition({ flag: 'on' });
    listener.close();

    expect(held).toEqual([
      { name: 'network', value: 'mocked', site: expect.stringMatching(SITE), level: 0xffff },
      { name: 'seeded', value: true, site: expect.stringMatching(SITE), level: 0 },
    ]);
    expect(listener.held('refunds')).toEqual([]);
    // The overridden `network=live` is kept: a row is resolved when it is read.
    expect(taken(listener, 'pays').map((item) => (item as [string])[0])).toEqual(['flag', 'network', 'network', 'seeded']);
  });

  it('reports a call made in an afterEach and records it on no case', () => {
    let standing: PreconditionStanding = { at: 'after' };
    const listener = listenForPreconditions(ROOT, () => standing);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    variancePrecondition({ network: 'mocked' });
    standing = { at: 'case', key: 'pays' };
    listener.close();

    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]![0])).toMatch(/ran after its case and is recorded on no case/);
    expect(taken(listener, 'pays')).toEqual([]);
  });

  it('throws for a call no case is running, finishing the sentence with the runner\'s reason', () => {
    const listener = listenForPreconditions(ROOT, () => ({ at: 'outside', because: 'ran in a beforeAll' }));

    expect(() => variancePrecondition({ network: 'mocked' })).toThrow(/ran in a beforeAll — a precondition belongs to the case/);
    listener.close();
  });

  it('gives the realm back the recorder that listened before it, or none', () => {
    const before = (): void => undefined;
    realm[PRECONDITION] = before;

    const listener = listenForPreconditions(ROOT, () => ({ at: 'case', key: 'pays' }));
    expect(realm[PRECONDITION]).not.toBe(before);
    listener.close();
    expect(realm[PRECONDITION]).toBe(before);

    delete realm[PRECONDITION];
    listenForPreconditions(ROOT, () => ({ at: 'case', key: 'pays' })).close();
    expect(PRECONDITION in realm).toBe(false);
  });
});
