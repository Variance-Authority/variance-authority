/**
 * What a test's pages asked the network for, told line by line.
 *
 * A line that waits on a response it never gets is the line a story most needs
 * to name, and the page cannot say it: an answer that is still out leaves no
 * trace in what the page ran. The runner hears every request its contexts send
 * from Playwright's own events — nothing in the page is patched — and the line
 * each was heard on is the one it is told on.
 *
 * A request is its method and path. The query and the body are the
 * application's data, often a token or a user's, and a story is written to disk
 * and read by whoever reads the run. The path is kept as it is.
 *
 * Only Playwright hears requests this way. The browser modes of Vitest and
 * Rstest and Storybook have no runner beside the page, and wait for the page's
 * own half: #1447.
 */

import type { BrowserContext, Request, Response } from '@playwright/test';
import { awaitedRequest } from '@variance-authority/playwright';

/** One test's requests, across every context it adopted. */
export interface HeardRequests {
  /** Hear what `context` sends; returns what stops hearing it. */
  readonly hear: (context: BrowserContext) => () => void;
  /**
   * What the line that just ended did: what it sent, what came back on it, in
   * the order heard, and what was still out at its end.
   */
  readonly told: () => readonly string[];
}

/** `GET /api/price`, or nothing for a request that is no fetch of a path: `data:`, `blob:`. */
function named(request: Request): string | undefined {
  const url = new URL(request.url());
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  return `${request.method()} ${url.pathname}`;
}

/**
 * The requests a story tells: the ones arrivals counts as carrying what a page
 * waits on. A font, an image and a channel are not, and every page has them.
 */
export function heardRequests(): HeardRequests {
  const out = new Map<Request, string>();
  const statuses = new WeakMap<Request, number>();
  let sent: string[] = [];
  let came: string[] = [];

  const onResponse = (response: Response): void => {
    statuses.set(response.request(), response.status());
  };
  const ended = (failed: boolean) => (request: Request): void => {
    const name = out.get(request);
    if (name === undefined) return;
    out.delete(request);
    came.push(failed ? `${name} failed` : `${name} ${statuses.get(request) ?? ''}`.trimEnd());
  };
  const onFinished = ended(false);
  const onFailed = ended(true);

  return {
    hear: (context) => {
      // A context that stops being heard can end no request it sent, so none stays out.
      const own = new Set<Request>();
      const onRequest = (request: Request): void => {
        const name = named(request);
        if (name === undefined || !awaitedRequest(request)) return;
        own.add(request);
        out.set(request, name);
        sent.push(name);
      };
      context.on('request', onRequest);
      context.on('response', onResponse);
      context.on('requestfinished', onFinished);
      context.on('requestfailed', onFailed);
      return () => {
        context.off('request', onRequest);
        context.off('response', onResponse);
        context.off('requestfinished', onFinished);
        context.off('requestfailed', onFailed);
        for (const request of own) out.delete(request);
      };
    },
    told: () => {
      const notes = sent.length === 0 ? [] : [`sent ${sent.join(', ')}`];
      notes.push(...came);
      if (out.size > 0) notes.push(`still out ${[...out.values()].join(', ')}`);
      sent = [];
      came = [];
      return notes;
    },
  };
}
