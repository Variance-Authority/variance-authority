import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listenForPreconditions, type PreconditionStanding } from './precondition-listener.js';
import { variancePrecondition } from './precondition.js';

const PRECONDITION = Symbol.for('variance-authority.test-selection.precondition');
const BREADCRUMB = Symbol.for('variance-authority.test-selection.breadcrumb');
const realm = globalThis as { [PRECONDITION]?: unknown; [BREADCRUMB]?: unknown };
const ROOT = resolve(import.meta.dirname, '../../../..');
const SITE = /^packages\/sense\/src\/test-selection\/precondition-listener\.test\.ts:\d+$/;

// What a listener hands over for a case: every item it said, unresolved, in the order the addon stores them.
const taken = (listener: { take(key: string): string | undefined }, key: string): unknown[] =>
  (JSON.parse(listener.take(key) ?? '{"said":[]}') as { said: unknown[] }).said;

// The two calls `@variance-authority/event`'s `varianceBreadcrumb` makes, which
// this package does not depend on: the value alone, then the `Error` that names
// the site when the recorder says the read is new to its case.
function varianceBreadcrumb<Value>(dimension: unknown, key: unknown, value: Value): Value {
  const recorder = realm[BREADCRUMB] as (dimension: unknown, key: unknown, value: unknown, called?: Error) => boolean;
  if (recorder(dimension, key, value)) recorder(dimension, key, value, new Error());
  return value;
}

// Everything a listener hands over for a case, facet by facet.
const heard = (listener: { take(key: string): string | undefined }, key: string): Record<string, unknown[]> | undefined => {
  const taken = listener.take(key);
  return taken === undefined ? undefined : (JSON.parse(taken) as Record<string, unknown[]>);
};

// The suite may itself run under a recording, which installed its own recorders.
let recording: unknown;
let reading: unknown;
beforeEach(() => {
  recording = realm[PRECONDITION];
  reading = realm[BREADCRUMB];
  delete realm[PRECONDITION];
  delete realm[BREADCRUMB];
});
afterEach(() => {
  if (recording === undefined) delete realm[PRECONDITION];
  else realm[PRECONDITION] = recording;
  if (reading === undefined) delete realm[BREADCRUMB];
  else realm[BREADCRUMB] = reading;
  vi.restoreAllMocks();
});

describe('a realm whose runner places each call itself', () => {
  it('lays a call made in the case body on that case, at the body level', () => {
    let standing: PreconditionStanding = { at: 'case', key: 'pays' };
    const listener = listenForPreconditions(ROOT, () => standing);

    variancePrecondition('fixture', { network: 'mocked' });
    standing = { at: 'beforeEach', key: 'refunds', depth: 1 };
    variancePrecondition('fixture', { seeded: true });
    listener.close();

    expect(taken(listener, 'pays')).toEqual([['fixture:network', '"mocked"', expect.stringMatching(SITE), 0xffff]]);
    expect(taken(listener, 'refunds')).toEqual([['fixture:seeded', 'true', expect.stringMatching(SITE), 1]]);
    expect(taken(listener, 'pays')).toEqual([]);
  });

  it('shows a running case what it has said so far, resolved, without taking it', () => {
    let standing: PreconditionStanding = { at: 'beforeEach', key: 'pays', depth: 0 };
    const listener = listenForPreconditions(ROOT, () => standing);

    variancePrecondition('fixture', { network: 'live', seeded: true });
    standing = { at: 'case', key: 'pays' };
    variancePrecondition('fixture', { network: 'mocked' });
    const held = listener.held('pays');
    variancePrecondition('fixture', { flag: 'on' });
    listener.close();

    expect(held).toEqual([
      { name: 'fixture:network', value: 'mocked', site: expect.stringMatching(SITE), level: 0xffff },
      { name: 'fixture:seeded', value: true, site: expect.stringMatching(SITE), level: 0 },
    ]);
    expect(listener.held('refunds')).toEqual([]);
    // The overridden `network=live` is kept: a row is resolved when it is read.
    expect(taken(listener, 'pays').map((item) => (item as [string])[0])).toEqual(['fixture:flag', 'fixture:network', 'fixture:network', 'fixture:seeded']);
  });

  it('reports a call made in an afterEach and records it on no case', () => {
    let standing: PreconditionStanding = { at: 'after' };
    const listener = listenForPreconditions(ROOT, () => standing);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    variancePrecondition('fixture', { network: 'mocked' });
    standing = { at: 'case', key: 'pays' };
    listener.close();

    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]![0])).toMatch(/ran after its case and is recorded on no case/);
    expect(taken(listener, 'pays')).toEqual([]);
  });

  it('throws for a call no case is running, finishing the sentence with the runner\'s reason', () => {
    const listener = listenForPreconditions(ROOT, () => ({ at: 'outside', because: 'ran in a beforeAll' }));

    expect(() => variancePrecondition('fixture', { network: 'mocked' })).toThrow(/ran in a beforeAll — a precondition belongs to the case/);
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

  it('gives the realm back the reader that listened before it, or none', () => {
    const before = (): boolean => false;
    realm[BREADCRUMB] = before;

    const listener = listenForPreconditions(ROOT, () => ({ at: 'case', key: 'pays' }));
    expect(realm[BREADCRUMB]).not.toBe(before);
    listener.close();
    expect(realm[BREADCRUMB]).toBe(before);

    delete realm[BREADCRUMB];
    listenForPreconditions(ROOT, () => ({ at: 'case', key: 'pays' })).close();
    expect(BREADCRUMB in realm).toBe(false);
  });
});

describe('what the code under test read in a realm whose runner places each call itself', () => {
  it('lays a read made in the case body or a beforeEach on that case, each key and value once', () => {
    let standing: PreconditionStanding = { at: 'beforeEach', key: 'pays', depth: 0 };
    const listener = listenForPreconditions(ROOT, () => standing);

    varianceBreadcrumb('flags', 'checkout', false);
    standing = { at: 'case', key: 'pays' };
    varianceBreadcrumb('flags', 'checkout', true);
    varianceBreadcrumb('flags', 'checkout', true);
    varianceBreadcrumb('flags', 7, true);
    listener.close();

    expect(heard(listener, 'pays')).toEqual({
      said: [],
      read: [
        ['flags:checkout', 'false', expect.stringMatching(SITE), 0xffff],
        ['flags:checkout', 'true', expect.stringMatching(SITE), 0xffff],
      ],
      misused: [['key', '7', expect.stringMatching(SITE), 0xffff]],
    });
  });

  it('hands over nothing for a case that neither said nor read anything, and names what it heard', () => {
    const listener = listenForPreconditions(ROOT, () => ({ at: 'case', key: 'pays' }));
    listener.close();

    expect(listener.take('pays')).toBeUndefined();
    expect(JSON.parse(listener.nothing)).toEqual({ said: [], read: [], misused: [] });
  });

  it('lays what a page read on the case the drain names, each site named from the checkout', () => {
    const listener = listenForPreconditions(ROOT, () => ({ at: 'after' }));
    const page = `http://app.test/@fs${ROOT}/src/flags.ts:4`;

    listener.laid('pays', [['read', ['flags:checkout', 'true', page, 0xffff]]]);
    listener.laid('pays', [['read', ['flags:checkout', 'true', `http://app.test/@fs${ROOT}/src/flags.ts:9`, 0xffff]]]);
    listener.close();

    expect(heard(listener, 'pays')).toEqual({ said: [], read: [['flags:checkout', 'true', 'src/flags.ts:4', 0xffff]], misused: [] });
    expect(listener.take('pays')).toBeUndefined();
  });
});
