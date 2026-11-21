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
  const began = (key: object, what: string): void => {
    flying.set(key, what);
    clock.began();
  };
  const ended = (key: object): void => {
    if (flying.delete(key)) clock.ended();
  };
  const undo: (() => void)[] = [];
  for (const host of hosts(document)) {
    const original = host.fetch;
    if (original !== undefined) {
      const followed: typeof fetch = function (this: unknown, input, init) {
        const key = {};
        began(key, `${init?.method ?? (input instanceof Request ? input.method : 'GET')} ${path(input, document)}`);
        return original.call(this, input, init).finally(() => ended(key));
      };
      host.fetch = followed;
      // Stop only what was started: a fetch somebody put there since is theirs.
      undo.push(() => {
        if (host.fetch === followed) host.fetch = original;
      });
    }
    const prototype = host.XMLHttpRequest?.prototype;
    if (prototype !== undefined) {
      const open = prototype.open;
      const send = prototype.send;
      const opened = new WeakMap<XMLHttpRequest, string>();
      const following = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]): void {
        opened.set(this, `${method.toUpperCase()} ${path(url, document)}`);
        (open as (...args: unknown[]) => void).call(this, method, url, ...rest);
      };
      const sending = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null): void {
        began(this, opened.get(this) ?? 'a request');
        this.addEventListener('loadend', () => ended(this), { once: true });
        send.call(this, body);
      };
      prototype.open = following as typeof open;
      prototype.send = sending;
      undo.push(() => {
        if (prototype.open === following) prototype.open = open;
        if (prototype.send === sending) prototype.send = send;
      });
    }
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
  const undo: (() => void)[] = [];
  for (const host of hosts(document)) {
    const original = host.open;
    if (original === undefined) continue;
    const following = function (this: unknown, ...args: Parameters<Window['open']>): Window | null {
      opened = true;
      return original.apply(this, args);
    };
    host.open = following;
    undo.push(() => {
      if (host.open === following) host.open = original;
    });
  }
  return {
    left: async () => {
      if (document.location.href !== href) {
        const { pathname, search, hash } = new URL(document.location.href);
        return `the page went to ${pathname}${search}${hash}`;
      }
      if (opened) return 'a new page opened';
      const now = modals(document);
      return [...now].some((each) => !before.has(each)) ? 'a modal dialog opened' : undefined;
    },
    stop: () => {
      for (const each of undo) each();
    },
  };
}

/** The modal dialogs open now: by `:modal` where the document knows it, and by `aria-modal` everywhere. */
function modals(document: Document): Set<Element> {
  const found = new Set<Element>(document.querySelectorAll('[aria-modal="true"]'));
  try {
    for (const each of document.querySelectorAll(':modal')) found.add(each);
  } catch {
    // A document without `:modal`, such as jsdom's, has no modal dialog but by `aria-modal`.
  }
  return found;
}

function path(input: RequestInfo | URL, document: Document): string {
  const url = typeof input === 'string' || input instanceof URL ? input : input.url;
  try {
    return new URL(url, document.baseURI).pathname;
  } catch {
    return String(url);
  }
}
