import { JOURNEY_COOKIE } from '@variance-authority/wire';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXECUTION_GLOBAL } from './execution-global.js';
import { reportPage } from './page.js';

const WATCHER = 'http://127.0.0.1:4000';
const RAN = { id: 'src/cart.ts@1', hits: [0, 1], shared: [] };

/**
 * A stand-in for the page, since this suite runs where there is none: what
 * `reportPage` listens to, the cookies it leaves and what it sends. The page
 * itself, with a server beside it, is `ran-page.chromium.test.ts`'s.
 */
function standIn(options: { cookies?: () => void; beacon?: () => boolean } = {}) {
  const on = new Map<string, () => void>();
  const listen = vi.fn((type: string, listener: () => void) => void on.set(type, listener));
  const cookies: string[] = [];
  const document = { addEventListener: listen };
  Object.defineProperty(document, 'cookie', {
    get: () => '',
    set: (value: string) => {
      options.cookies?.();
      cookies.push(value);
    },
  });
  const sent = vi.fn((_url: string, _init: { body: string }) => Promise.resolve(new Response()));
  vi.stubGlobal('document', document);
  vi.stubGlobal('addEventListener', listen);
  vi.stubGlobal('fetch', sent);
  if (options.beacon !== undefined) vi.stubGlobal('navigator', { sendBeacon: options.beacon });
  vi.stubGlobal(EXECUTION_GLOBAL, { drain: () => ({ instrumentation: 'regions', modules: [RAN] }) });
  /** How many executions were named: each leaves the journey cookie once. */
  const named = (): number =>
    cookies.filter((cookie) => cookie.startsWith(`${JOURNEY_COOKIE}=`) && !cookie.includes('Max-Age=0')).length;
  return { on, listen, cookies, sent, named };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('a page given nowhere to report', () => {
  it.each([
    ['no address', undefined],
    ['an empty address, as an unset variable arrives from a build', ''],
    ['an address on another machine', 'http://203.0.113.7:4000'],
    ['an address that is not http', 'https://127.0.0.1:4000'],
  ])('installs nothing for %s', (_, watcher) => {
    const page = standIn();
    expect(reportPage(watcher)).toBeUndefined();
    expect(page.listen).not.toHaveBeenCalled();
    expect(page.cookies).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('a page that reports', () => {
  it('names one execution for a click and the submit it causes, and another for a submit alone', () => {
    const page = standIn({ beacon: () => true });
    reportPage(WATCHER);
    expect(page.named()).toBe(1);
    page.on.get('click')!();
    page.on.get('submit')!();
    expect(page.named()).toBe(2);
    vi.advanceTimersByTime(0);
    page.on.get('submit')!();
    expect(page.named()).toBe(3);
  });

  it('sends what a refused beacon carried another way', () => {
    const page = standIn({ beacon: () => false });
    reportPage(WATCHER);
    page.on.get('click')!();
    expect(page.sent).toHaveBeenCalledTimes(1);
    const [url, init] = page.sent.mock.calls[0]!;
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:4000\/[0-9a-f]{32}\/journeys$/);
    expect(JSON.parse(init.body)).toMatchObject({ head: 'page', scope: 'journey', modules: [RAN] });
  });
});

describe('a page that cannot be reported from', () => {
  it('is left running by a browser with no beacon', () => {
    const page = standIn();
    expect('sendBeacon' in navigator).toBe(false);
    reportPage(WATCHER);
    expect(() => page.on.get('click')!()).not.toThrow();
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
    expect(page.sent).toHaveBeenCalled();
  });

  it('installs nothing where a cookie cannot be left', () => {
    const page = standIn({
      cookies: () => {
        throw new Error('The document is sandboxed and lacks the allow-same-origin flag.');
      },
    });
    expect(() => reportPage(WATCHER)).not.toThrow();
    expect(page.listen).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
