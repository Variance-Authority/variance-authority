import { JOURNEY_COOKIE, RETURN_COOKIE } from '@variance-authority/wire';
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
function standIn(options: { cookies?: () => void; beacon?: () => boolean; left?: Record<string, string> } = {}) {
  const on = new Map<string, () => void>();
  /** Where each listener was put, as `target type phase`. Order between targets is the browser's, and `ran-page.chromium.test.ts`'s. */
  const put: string[] = [];
  const listener = (target: string) => (type: string, heard: () => void, capture?: boolean) => {
    put.push(`${target} ${type} ${capture === true ? 'capture' : 'bubble'}`);
    on.set(type, heard);
  };
  const listen = vi.fn(listener('window'));
  const listenDocument = vi.fn(listener('document'));
  const cookies: string[] = [];
  /** What the document holds, as a browser keeps it: a write of no age takes its cookie away. */
  const jar = new Map(Object.entries(options.left ?? {}));
  const document = { addEventListener: listenDocument };
  Object.defineProperty(document, 'cookie', {
    get: () => [...jar].map(([name, value]) => `${name}=${value}`).join('; '),
    set: (value: string) => {
      options.cookies?.();
      cookies.push(value);
      const [name = '', held = ''] = value.split(';')[0]!.split('=');
      if (value.includes('Max-Age=0')) jar.delete(name);
      else jar.set(name, held);
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
  return { on, put, cookies, jar, sent, named };
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
    expect(page.put).toEqual([]);
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

  it('hears a click and a submit where they are heard first: on the window, in the capture phase', () => {
    const page = standIn({ beacon: () => true });
    reportPage(WATCHER);
    expect(page.put.filter((one) => /click|submit/.test(one))).toEqual(['window click capture', 'window submit capture']);
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

describe('a page somebody else reports', () => {
  it('installs nothing on a page a driver left its cookies on', () => {
    const drain = vi.fn();
    const page = standIn({ left: { [JOURNEY_COOKIE]: 'driven', [RETURN_COOKIE]: 'http://127.0.0.1:5000/driven' } });
    vi.stubGlobal(EXECUTION_GLOBAL, { drain });
    reportPage(WATCHER);
    vi.advanceTimersByTime(1000);
    expect(page.put).toEqual([]);
    expect(page.cookies).toEqual([]);
    expect(drain).not.toHaveBeenCalled();
  });

  it('reports a page whose cookies another page left for this watcher', () => {
    const page = standIn({
      beacon: () => true,
      left: { [JOURNEY_COOKIE]: 'another', [RETURN_COOKIE]: encodeURIComponent(`${WATCHER}/another`) },
    });
    reportPage(WATCHER);
    expect(page.named()).toBe(1);
    expect(page.jar.get(JOURNEY_COOKIE)).not.toBe('another');
  });

  it('does nothing when called a second time on one document', () => {
    const page = standIn({ beacon: () => true });
    reportPage(WATCHER);
    const held = page.jar.get(JOURNEY_COOKIE);
    reportPage(WATCHER);
    expect(page.named()).toBe(1);
    expect(page.jar.get(JOURNEY_COOKIE)).toBe(held);
    expect(page.put).toHaveLength(4);
    expect(vi.getTimerCount()).toBe(1);
  });
});

describe('a page that goes away', () => {
  it('takes its cookies with it', () => {
    const page = standIn({ beacon: () => true });
    reportPage(WATCHER);
    page.on.get('pagehide')!();
    expect([...page.jar.keys()]).toEqual([]);
  });

  it('leaves the cookies the next document has already named its own', () => {
    const page = standIn({ beacon: () => true });
    reportPage(WATCHER);
    page.jar.set(JOURNEY_COOKIE, 'next');
    page.jar.set(RETURN_COOKIE, encodeURIComponent(`${WATCHER}/next`));
    page.on.get('pagehide')!();
    expect(page.jar.get(JOURNEY_COOKIE)).toBe('next');
    expect(page.jar.has(RETURN_COOKIE)).toBe(true);
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
    expect(page.put).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
