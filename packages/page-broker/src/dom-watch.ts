// compass: variance-authority.harness
import { quietPeriod } from './quiet-period.js';
import type { Elsewhere, Quiet } from './surface.js';

interface Host {
  fetch?: typeof fetch;
  XMLHttpRequest?: typeof XMLHttpRequest;
  open?: Window['open'];
}

/** The globals an app in this document calls: its window, and the test's global where that is another object. */
function hosts(document: Document): Host[] {
  return [...new Set<Host>([globalThis as Host, ...(document.defaultView === null ? [] : [document.defaultView as Host])])];
}

interface Hook {
  original: unknown;
  wrapper: unknown;
  followers: Set<unknown>;
}

const hooks = new WeakMap<object, Map<PropertyKey, Hook>>();

/**
 * Puts one wrapper on `owner[key]` however many actions follow it at once, so
 * each sees every call, and the original back when the last of them stops.
 * Stop only what was started: a value somebody put there since is theirs, and
 * the next action wraps it afresh.
 */
function hook<F>(owner: object, key: PropertyKey, follower: F, wrap: (original: never, followers: ReadonlySet<F>) => unknown): () => void {
  const slot = owner as Record<PropertyKey, unknown>;
  let keys = hooks.get(owner);
  if (keys === undefined) hooks.set(owner, (keys = new Map()));
  let found = keys.get(key);
  if (found === undefined || slot[key] !== found.wrapper) {
    const followers = new Set<unknown>();
    found = { original: slot[key], wrapper: wrap(slot[key] as never, followers as Set<F>), followers };
    slot[key] = found.wrapper;
    keys.set(key, found);
  }
  const hooked = found;
  hooked.followers.add(follower);
  return () => {
    hooked.followers.delete(follower);
    if (hooked.followers.size > 0) return;
    if (keys.get(key) === hooked) keys.delete(key);
    if (slot[key] === hooked.wrapper) slot[key] = hooked.original;
  };
}

/**
 * When a response's body has arrived, read from a copy so the app's own read
 * is untouched: `fetch` answers once the headers have, and the answer an app
 * acts on is in the body. A server-sent stream never ends, and is not waited
 * for.
 */
async function arrived(response: Response): Promise<void> {
  if (response.body === null || response.headers.get('content-type')?.includes('text/event-stream')) return;
  await response
    .clone()
    .arrayBuffer()
    .catch(() => undefined);
}

/** What a request was opened with, for the requests opened while any action followed them. */
const opened = new WeakMap<XMLHttpRequest, [string, string | URL]>();

type Started = (method: string, url: RequestInfo | URL) => () => void;

/**
 * Quiet in a document: no request made with `fetch` or `XMLHttpRequest` in
 * flight and no change to the document for `period` ms. Followed from before
 * the act, so none it starts is missed. A stream, a socket or a picture is not
 * followed: none of them is a sign of an answer on its way.
 */
export function pending(document: Document, period: number): Quiet {
  const flying = new Map<object, string>();
  const clock = quietPeriod(period, () => flying.size);
  let changed = 0;
  const started: Started = (method, url) => {
    const key = {};
    flying.set(key, `${method.toUpperCase()} ${path(url, document)}`);
    clock.began();
    return () => {
      if (flying.delete(key)) clock.ended();
    };
  };
  const undo: (() => void)[] = [];
  const prototypes = new Set<XMLHttpRequest>();
  for (const host of hosts(document)) {
    if (host.fetch !== undefined) {
      undo.push(
        hook(host, 'fetch', started, (original: typeof fetch, followers) =>
          function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
            const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
            const ends = [...followers].map((each) => each(method, input));
            const end = (): void => {
              for (const each of ends) each();
            };
            return original.call(this, input, init).then(
              (response) => {
                void arrived(response).finally(end);
                return response;
              },
              (error: unknown) => {
                end();
                throw error;
              },
            );
          },
        ),
      );
    }
    if (host.XMLHttpRequest !== undefined) prototypes.add(host.XMLHttpRequest.prototype);
  }
  // One prototype may serve both globals: it is wrapped once.
  for (const prototype of prototypes) {
    undo.push(
      hook(prototype, 'open', started, (original: XMLHttpRequest['open']) =>
        function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]): void {
          opened.set(this, [method, url]);
          (original as (...args: unknown[]) => void).call(this, method, url, ...rest);
        },
      ),
      hook(prototype, 'send', started, (original: XMLHttpRequest['send'], followers) =>
        function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null): void {
          const request = opened.get(this);
          // Opened before the follow began, or never: not followed, and a send of one never opened is refused anyway.
          if (request === undefined) return original.call(this, body);
          const ends = [...followers].map((each) => each(...request));
          this.addEventListener(
            'loadend',
            () => {
              for (const end of ends) end();
            },
            { once: true },
          );
          original.call(this, body);
        },
      ),
    );
  }
  const observer = new (document.defaultView!.MutationObserver)(() => {
    changed = Date.now();
    clock.began();
    clock.ended();
  });
  observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  return {
    settled: clock.settled,
    still: clock.still,
    held: () => {
      if (flying.size > 0) return `${[...flying.values()].join(', ')} still in flight`;
      return Date.now() - changed < period ? 'the document kept changing' : undefined;
    },
    stop: () => {
      clock.stop();
      observer.disconnect();
      for (const each of undo) each();
    },
  };
}

/**
 * Follows the three ways an app leaves the document a test declared outcomes
 * on: its location changes, a hash or history change included, it opens
 * another window, or a modal dialog covers it.
 */
export function away(document: Document): Elsewhere {
  const href = document.location.href;
  const before = modals(document);
  let opened = false;
  const follower = (): void => {
    opened = true;
  };
  const undo: (() => void)[] = [];
  for (const host of hosts(document)) {
    if (host.open === undefined) continue;
    undo.push(
      hook(host, 'open', follower, (original: Window['open'], followers) =>
        function (this: unknown, ...args: Parameters<Window['open']>): Window | null {
          for (const each of followers) each();
          return original.apply(this, args);
        },
      ),
    );
  }
  return {
    left: async () => {
      // A new page or a modal is told before a new address: either rules out
      // staying, and an address change alone does not.
      if (opened) return { by: 'page', words: 'a new page opened' };
      // Shown now and not before: a dialog mounted hidden and then shown opened just the same.
      if ([...modals(document)].some((each) => !before.has(each))) return { by: 'modal', words: 'a modal dialog opened' };
      if (document.location.href === href) return undefined;
      const { pathname, search, hash } = new URL(document.location.href);
      return { by: 'address', words: `the page went to ${pathname}${search}${hash}` };
    },
    stop: () => {
      for (const each of undo) each();
    },
  };
}

/** The modal dialogs open and shown now: by `:modal` where the document knows it, and by `aria-modal` everywhere. */
function modals(document: Document): Set<Element> {
  const found = new Set<Element>(document.querySelectorAll('[aria-modal="true"]'));
  try {
    for (const each of document.querySelectorAll(':modal')) found.add(each);
  } catch {
    // A document without `:modal`, such as jsdom's, has no modal dialog but by `aria-modal`.
  }
  return new Set([...found].filter(shown));
}

/**
 * Whether a person could see the element, as far as a document without layout
 * can tell: neither it nor any element around it is hidden or not displayed.
 */
export function shown(element: Element): boolean {
  const view = element.ownerDocument.defaultView;
  for (let at: Element | null = element; at !== null; at = at.parentElement) {
    if ((at as HTMLElement).hidden) return false;
    const style = view?.getComputedStyle(at);
    if (style?.display === 'none' || style?.visibility === 'hidden') return false;
  }
  return element.isConnected;
}

function path(input: RequestInfo | URL, document: Document): string {
  const url = typeof input === 'string' || input instanceof URL ? input : input.url;
  try {
    return new URL(url, document.baseURI).pathname;
  } catch {
    return String(url);
  }
}
