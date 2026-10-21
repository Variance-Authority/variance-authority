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
      misused: [],
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

  it('lays a read under a beforeEach that names its case on that case', () => {
    const recorder = preconditions.recorder(holder, () => undefined, undefined, undefined, true);
    recorder.loaded();
    const site = recorder.within({ kind: 'each', depth: 1, case: keyOf('pays') }, () => read('network', 'api', 'mocked').site);
    expect(recorder.take(keyOf('pays')).read).toEqual([['network:api', '"mocked"', site, preconditions.CASE_LEVEL]]);
  });

  it('keeps a value read under a beforeEach and again in the case body once, at the beforeEach\'s site', () => {
    let running: string | undefined;
    const recorder = preconditions.recorder(holder, () => running, undefined, undefined, true);
    recorder.loaded();
    const token = {};
    recorder.begin(token);
    const site = recorder.within({ kind: 'each', depth: 1, token }, () => read('flags', 'checkout', true).site);
    recorder.entered(keyOf('pays'), token);
    running = keyOf('pays');
    expect(read('flags', 'checkout', true).asked).toBe(true);
    expect(recorder.take(keyOf('pays')).read).toEqual([['flags:checkout', 'true', site, preconditions.CASE_LEVEL]]);
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

  it('records a call it cannot name as a misuse apart from the reads: the argument that was wrong and the value it was given', () => {
    const running = keyOf('pays');
    const recorder = preconditions.recorder(holder, () => running, undefined, undefined, true);
    recorder.loaded();
    let site = '';
    for (const [dimension, key] of [[7, 'checkout'], ['flags:x', 'checkout'], ['', 'checkout'], ['flags', 7], ['flags', ''], [undefined, 'checkout']] as const) {
      site = read(dimension, key, true).site;
    }
    const heard = recorder.take(running);
    expect(heard.read).toEqual([]);
    expect(heard.misused!.map(([argument, value, at]) => [argument, value, at])).toEqual([
      ['dimension', '7', site],
      ['dimension', '"flags:x"', site],
      ['dimension', '""', site],
      ['key', '7', site],
      ['key', '""', site],
      ['dimension', null, site],
    ]);
  });

  it('keeps a misuse once per argument and value, at its first site, and asks no site for it again', () => {
    const running = keyOf('pays');
    const recorder = preconditions.recorder(holder, () => running, undefined, undefined, true);
    recorder.loaded();
    const recorded = holder[BREADCRUMB]!;
    // The site is the frame that called `varianceBreadcrumb`: here, the line that called `breadcrumb`.
    const breadcrumb = () => new Error('varianceBreadcrumb');
    const first = breadcrumb();
    expect(recorded(7, 'checkout', true)).toBe(true);
    expect(recorded(7, 'checkout', true, first)).toBe(false);
    expect(recorded(7, 'checkout', true)).toBe(false);
    expect(recorder.take(running).misused).toEqual([['dimension', '7', preconditions.siteOf(first), preconditions.CASE_LEVEL]]);
  });

  it('keeps an array or an object given as a misuse by its kind alone, and a value JSON cannot hold as nothing', () => {
    const running = keyOf('pays');
    const recorder = preconditions.recorder(holder, () => running, undefined, undefined, true);
    recorder.loaded();
    read({ flags: { checkout: true } }, 'checkout', true);
    read(['flags'], 'checkout', true);
    read('flags', Symbol('checkout'), true);
    expect(recorder.take(running).misused!.map(([argument, value]) => [argument, value])).toEqual([
      ['dimension', '{}'],
      ['dimension', '[]'],
      ['key', null],
    ]);
  });

  it('lays a misuse made while the file loads on every case of the file, at level 0', () => {
    let running: string | undefined;
    const recorder = preconditions.recorder(holder, () => running, undefined, undefined, true);
    const { site } = read('flags', 7, true);
    recorder.loaded();
    for (const name of ['pays', 'refunds']) {
      running = keyOf(name);
      expect(recorder.take(running)).toEqual({ said: [], read: [], misused: [['key', '7', site, 0]] });
    }
  });

  it('warns once for a misuse where no case runs, saying what was wrong, and records it nowhere', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let running: string | undefined;
    const recorder = preconditions.recorder(holder, () => running, undefined, undefined, true);
    recorder.loaded();
    for (let at = 0; at < 2; at += 1) read('flags', '', true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('was misused (the key is empty) where no case runs');
    running = keyOf('pays');
    expect(recorder.take(running)).toEqual({ said: [], read: [], misused: [] });
  });

  it('keeps a value JSON cannot hold under the name it was read by, as unrecorded', () => {
    const running = keyOf('pays');
    const recorder = preconditions.recorder(holder, () => running, undefined, undefined, true);
    recorder.loaded();
    read('flags', 'checkout', () => true);
    expect(recorder.take(running).read!.map(([name, value]) => [name, value])).toEqual([['flags:checkout', null]]);
  });

  it('installs nothing to read with and carries no read facet where the runner does not listen to reads', () => {
    const running = keyOf('pays');
    const recorder = preconditions.recorder(holder, () => running);
    expect(holder[BREADCRUMB]).toBeUndefined();
    expect(recorder.take(running)).toEqual({ said: [] });
  });
});
