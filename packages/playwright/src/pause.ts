import type { CDPSession, Page, Route } from 'playwright';

/**
 * A request held before it leaves, whichever way it was held.
 *
 * What to refuse, what to read and what to serve instead is decided once, in
 * `network.ts`, over this; the two ways of holding a request below cannot drift
 * apart in what they record because neither decides anything. Only the holding
 * differs, and with it whether the browser's HTTP cache stays on.
 */
export interface Paused {
  readonly url: string;
  /** Playwright's vocabulary: `image`, `font`, `media`, `script`, … */
  readonly resourceType: string;
  /** Lower-cased names. */
  readonly headers: Readonly<Record<string, string>>;
  abort(): Promise<void>;
  continue(): Promise<void>;
  /** Let it go and hold its answer, or `null` when the answer is a redirect the browser follows. */
  fetch(): Promise<Answered | null>;
  /** Answer it with these bytes instead of letting it go. */
  serve(contentType: string, body: Uint8Array): Promise<void>;
}

export interface Answered {
  readonly body: Buffer;
  /** Lower-cased names. */
  readonly headers: Readonly<Record<string, string>>;
  /** Hand the page these bytes under the answer's status and headers. */
  fulfill(body: Uint8Array): Promise<void>;
  /**
   * Hand the page the answer as it arrived. Kept apart from `fulfill` because
   * the browser caches an answer it let through and never one it was handed.
   */
  pass(): Promise<void>;
}

/** Stop holding requests. */
export type Unpause = () => Promise<void>;

/** Hold every request through Playwright's routing, which turns the HTTP cache off. */
export async function pauseByRoute(page: Page, handle: (request: Paused) => Promise<void>): Promise<Unpause> {
  const route = async (held: Route): Promise<void> => {
    const request = held.request();
    await handle({
      url: request.url(),
      resourceType: request.resourceType(),
      headers: request.headers(),
      abort: async () => held.abort('aborted'),
      continue: async () => held.continue(),
      async fetch() {
        const response = await held.fetch();
        return {
          body: await response.body(),
          headers: response.headers(),
          fulfill: async (body) => held.fulfill({ response, body: Buffer.from(body) }),
          // Routing has the cache off, so there is nothing to keep it for.
          pass: async () => held.fulfill({ response }),
        };
      },
      serve: async (contentType, body) => held.fulfill({ status: 200, contentType, body: Buffer.from(body) }),
    });
  };
  await page.route('**/*', route);
  return async () => page.unroute('**/*', route);
}

/** The parts of `Fetch.requestPaused` read here. */
interface PausedEvent {
  readonly requestId: string;
  readonly networkId?: string;
  readonly resourceType: string;
  readonly request: { readonly url: string; readonly headers: Readonly<Record<string, string>> };
  readonly responseStatusCode?: number;
  readonly responseErrorReason?: string;
  readonly responseHeaders?: readonly { readonly name: string; readonly value: string }[];
}

/**
 * Hold every request through the DevTools protocol, with the HTTP cache left on.
 *
 * A request is paused once before it leaves, and a read one again when its
 * answer arrives — from the server or from the cache, both pass. A request
 * cancelled while its answer is awaited never pauses a second time, so the wait
 * also ends on the network's own word that it failed.
 *
 * Chromium only. The page's session does not reach a cross-origin frame, which
 * runs in a process of its own.
 */
export async function pauseByProtocol(page: Page, handle: (request: Paused) => Promise<void>): Promise<Unpause> {
  const session: CDPSession = await page.context().newCDPSession(page);
  // Answers awaited, by the paused request's id; and that id by the one the
  // network's own events name the request by.
  const awaiting = new Map<string, { resolve(event: PausedEvent): void; reject(error: Error): void }>();
  const byNetworkId = new Map<string, string>();

  session.on('Fetch.requestPaused', (event: PausedEvent) => {
    if (event.responseStatusCode !== undefined || event.responseErrorReason !== undefined) {
      const waiter = awaiting.get(event.requestId);
      if (waiter !== undefined) waiter.resolve(event);
      else void session.send('Fetch.continueRequest', { requestId: event.requestId }).catch(() => {});
      return;
    }
    void handle(pausedRequest(event));
  });
  session.on('Network.loadingFailed', (event: { requestId: string; errorText: string }) => {
    const requestId = byNetworkId.get(event.requestId);
    if (requestId !== undefined) awaiting.get(requestId)?.reject(new Error(event.errorText));
  });

  // The network's events only for that failure; no body is kept by them.
  await session.send('Network.enable', { maxPostDataSize: 0 });
  await session.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });

  return async () => {
    for (const waiter of awaiting.values()) waiter.reject(new Error('the observation was closed'));
    await session.send('Fetch.disable').catch(() => {});
    await session.detach().catch(() => {});
  };

  function pausedRequest(event: PausedEvent): Paused {
    const { requestId, networkId } = event;
    return {
      url: event.request.url,
      resourceType: event.resourceType.toLowerCase(),
      headers: lowerCased(Object.entries(event.request.headers)),
      abort: async () => {
        await session.send('Fetch.failRequest', { requestId, errorReason: 'Aborted' });
      },
      continue: async () => {
        await session.send('Fetch.continueRequest', { requestId });
      },
      async fetch() {
        const answered = new Promise<PausedEvent>((resolve, reject) => awaiting.set(requestId, { resolve, reject }));
        if (networkId !== undefined) byNetworkId.set(networkId, requestId);
        let answer: PausedEvent;
        try {
          await session.send('Fetch.continueRequest', { requestId, interceptResponse: true });
          answer = await answered;
        } finally {
          awaiting.delete(requestId);
          if (networkId !== undefined) byNetworkId.delete(networkId);
        }
        if (answer.responseErrorReason !== undefined) throw new Error(answer.responseErrorReason);
        const status = answer.responseStatusCode ?? 200;
        if (status >= 300 && status < 400) {
          // The target is paused again as a request of its own, and read there.
          await session.send('Fetch.continueRequest', { requestId });
          return null;
        }
        const read = await session.send('Fetch.getResponseBody', { requestId });
        const listed = answer.responseHeaders ?? [];
        return {
          body: Buffer.from(read.body, read.base64Encoded ? 'base64' : 'utf8'),
          headers: lowerCased(listed.map(({ name, value }) => [name, value])),
          fulfill: async (served) => {
            await session.send('Fetch.fulfillRequest', {
              requestId,
              responseCode: status,
              // The length and the encoding described the bytes that arrived;
              // what is handed over is decoded, and may be a single frame.
              responseHeaders: listed.filter(({ name }) => !/^content-(length|encoding)$/i.test(name)),
              body: Buffer.from(served).toString('base64'),
            });
          },
          pass: async () => {
            await session.send('Fetch.continueResponse', { requestId });
          },
        };
      },
      serve: async (contentType, body) => {
        await session.send('Fetch.fulfillRequest', {
          requestId,
          responseCode: 200,
          responseHeaders: [{ name: 'content-type', value: contentType }],
          body: Buffer.from(body).toString('base64'),
        });
      },
    };
  }
}

function lowerCased(entries: readonly (readonly [string, string])[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of entries) headers[name.toLowerCase()] = value;
  return headers;
}
