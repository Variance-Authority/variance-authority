import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import preconditions from './case-preconditions.cjs';

const BREADCRUMB = Symbol.for('variance-authority.test-selection.breadcrumb');
type Recorder = (dimension: unknown, key: unknown, value: unknown, called?: Error) => boolean;

// A private holder, so the suite's own recording, if any, is never touched.
let holder: { [BREADCRUMB]?: Recorder };
beforeEach(() => {
  holder = {};
});
afterEach(() => {
  vi.restoreAllMocks();
});

const keyOf = (name: string): string => `/repo/a.test.ts\u0000${name}\u00001`;

/** A read as `varianceBreadcrumb` makes it: asked first, and its site handed over only when the answer is new. */
function read(dimension: unknown, key: unknown, value: unknown): { asked: boolean; site: string } {
  const recorder = holder[BREADCRUMB]!;
  const asked = recorder(dimension, key, value);
  const called = new Error('varianceBreadcrumb');
  if (asked) expect(recorder(dimension, key, value, called)).toBe(false);
  return { asked, site: preconditions.siteOf(called) };
}

describe('the recorder of what the code read', () => {
  it('lays a read in a case body on that case, once per name and value, at the site it was first read', () => {
    let running: string | undefined;
    const recorder = preconditions.recorder(holder, () => running, undefined, undefined, true);
    recorder.loaded();
    running = keyOf('pays');
    const first = read('flags', 'checkout', true);
    const again = read('flags', 'checkout', true);
    expect([first.asked, again.asked]).toEqual([true, false]);
    expect(recorder.take(keyOf('pays'))).toEqual({
      said: [],
      read: [['flags:checkout', 'true', first.site, preconditions.CASE_LEVEL]],
    });
  });

  it('keeps every value one key was read with', () => {
    const running = keyOf('pays');
    const recorder = preconditions.recorder(holder, () => running, undefined, undefined, true);
    recorder.loaded();
    const on = read('flags', 'checkout', true);
    const off = read('flags', 'checkout', false);
    expect(recorder.take(running).read).toEqual([
      ['flags:checkout', 'true', on.site, preconditions.CASE_LEVEL],
      ['flags:checkout', 'false', off.site, preconditions.CASE_LEVEL],
    ]);
  });

  it('lays a read while the file loads on every case of the file, at level 0', () => {
    let running: string | undefined;
    const recorder = preconditions.recorder(holder, () => running, undefined, undefined, true);
    const loaded = read('copy', 'label', 'Pay');
    recorder.loaded();
    for (const name of ['pays', 'refunds']) {
      running = keyOf(name);
      expect(recorder.take(keyOf(name)).read).toEqual([['copy:label', '"Pay"', loaded.site, 0]]);
    }
  });

  it('keeps a case\'s own read of a value the file read as it loaded, at the case\'s site, as the native fold does', () => {
    let running: string | undefined;
    const recorder = preconditions.recorder(holder, () => running, undefined, undefined, true);
    read('copy', 'label', 'Pay');
    recorder.loaded();
    running = keyOf('pays');
    const own = read('copy', 'label', 'Pay');
    expect(own.asked).toBe(true);
    expect(recorder.take(running).read).toEqual([['copy:label', '"Pay"', own.site, preconditions.CASE_LEVEL]]);
  });

  it('asks again for each case, so a read is laid on every case that made it', () => {
    let running = keyOf('pays');
    const recorder = preconditions.recorder(holder, () => running, undefined, undefined, true);
    recorder.loaded();
    read('flags', 'checkout', true);
    recorder.take(running);
    running = keyOf('refunds');
    expect(read('flags', 'checkout', true).asked).toBe(true);
    expect(recorder.take(running).read).toHaveLength(1);
  });

  it('lays a read under a beforeEach that names no case on the case entered with its token', () => {
    const recorder = preconditions.recorder(holder, () => undefined, undefined, undefined, true);
    recorder.loaded();
    const token = {};
    recorder.begin(token);
    const site = recorder.within({ kind: 'each', depth: 1, token }, () => read('network', 'api', 'mocked').site);
    recorder.entered(keyOf('pays'), token);
    expect(recorder.take(keyOf('pays')).read).toEqual([['network:api', '"mocked"', site, preconditions.CASE_LEVEL]]);
  });

  it('records a read no case runs on nowhere, warns once for its site, and never throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let running: string | undefined;
    const recorder = preconditions.recorder(holder, () => running, undefined, undefined, true);
    recorder.loaded();
    const sites = new Set<string>();
    for (let at = 0; at < 3; at += 1) sites.add(read('flags', 'checkout', true).site);
    expect(sites.size).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('read flags:checkout where no case runs');
    running = keyOf('pays');
    expect(recorder.take(running).read).toEqual([]);
  });

  it('names a read with no string dimension and key under the empty dimension, and a value JSON cannot hold as unrecorded', () => {
    const running = keyOf('pays');
    const recorder = preconditions.recorder(holder, () => running, undefined, undefined, true);
    recorder.loaded();
    read(7, 'checkout', () => true);
    read('flags:x', 'checkout', 1);
    expect(recorder.take(running).read!.map(([name, value]) => [name, value])).toEqual([
      [':7:checkout', null],
      [':flags:x:checkout', '1'],
    ]);
  });

  it('installs nothing to read with and carries no read facet where the runner does not listen to reads', () => {
    const running = keyOf('pays');
    const recorder = preconditions.recorder(holder, () => running);
    expect(holder[BREADCRUMB]).toBeUndefined();
    expect(recorder.take(running)).toEqual({ said: [] });
  });
});
