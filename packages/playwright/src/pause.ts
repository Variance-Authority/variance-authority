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
  /**
   * Let it go and hold its answer, or `null` when there is nothing to read: the
   * answer is a redirect the browser follows, or the frame or worker that asked
   * is gone, and with it every reason to read the request.
   */
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

/** Which frame or worker could not be held, and why, said as a sentence; it runs unheld. */
export type Unreached = (message: string) => void;

/**
 * The frame or worker a request came from is gone.
 *
 * Not a failure to read: nothing will show what it asked for, so there is
 * nothing to record and nothing to let go.
 */
class Gone extends Error {}

/** Rethrow anything but {@link Gone}. */
function unlessGone(error: unknown): void {
  if (!(error instanceof Gone)) throw error;
}

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

/** The parts of `Target.attachedToTarget` read here. */
interface AttachedEvent {
  readonly sessionId: string;
  readonly targetInfo: { readonly type: string; readonly url: string };
}

/** What a request is waited on with, by the paused request's id. */
type Awaiting = Map<string, { resolve(event: PausedEvent): void; reject(error: Error): void }>;

/**
 * The waits of the target whose interception pauses a request: the answers
 * awaited, by the paused request's id, and that id by the one the network's own
 * events name the request by.
 */
interface Holder {
  readonly awaiting: Awaiting;
  readonly byNetworkId: Map<string, string>;
  /**
   * A request that failed before its answer, by the network's id, until the
   * network says whether it failed for good or the browser asked again.
   */
  readonly verdicts: Map<string, { resolve(): void; reject(error: Error): void }>;
}

/** One target held: its requests, and the targets reached through it. */
interface Reach {
  /** Resolves once the target holds its requests. */
  readonly ready: Promise<void>;
  /** Stop holding: reach no further target, and let go of what is held. Live targets only. */
  close(): Promise<void>;
  /** End every wait in this target and in those reached through it; nothing is sent. */
  forget(error: Error): void;
}

/**
 * One target's DevTools session: the page's own, or a frame's reached through it.
 *
 * The page's session is Playwright's `CDPSession`. A frame's is not one
 * Playwright hands out, so its messages travel inside the page's, as
 * `Target.sendMessageToTarget` and `Target.receivedMessageFromTarget`.
 */
interface Channel {
  send(method: string, params?: object): Promise<any>;
  on(event: string, listener: (params: any) => void): void;
}

/** A child target's session, carried inside its parent's. */
class Carried implements Channel {
  readonly #parent: Channel;
  readonly #sessionId: string;
  readonly #pending = new Map<number, { resolve(result: unknown): void; reject(error: Error): void }>();
  readonly #listeners = new Map<string, ((params: any) => void)[]>();
  #next = 0;
  #gone = false;

  constructor(parent: Channel, sessionId: string) {
    this.#parent = parent;
    this.#sessionId = sessionId;
  }

  send(method: string, params: object = {}): Promise<any> {
    if (this.#gone) return Promise.reject(new Gone(`${method}: the target is gone`));
    const id = ++this.#next;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      const message = JSON.stringify({ id, method, params });
      // The parent refuses a message only for a session it no longer has.
      this.#parent.send('Target.sendMessageToTarget', { sessionId: this.#sessionId, message }).catch((error: Error) => {
        this.#pending.delete(id);
        reject(new Gone(`${method}: ${error.message}`));
      });
    });
  }

  on(event: string, listener: (params: any) => void): void {
    this.#listeners.set(event, [...(this.#listeners.get(event) ?? []), listener]);
  }

  receive(raw: string): void {
    const message = JSON.parse(raw) as {
      id?: number;
      method?: string;
      params?: unknown;
      result?: unknown;
      error?: { message: string };
    };
    if (message.id !== undefined) {
      const waiter = this.#pending.get(message.id);
      this.#pending.delete(message.id);
      if (message.error !== undefined) waiter?.reject(new Error(message.error.message));
      else waiter?.resolve(message.result);
      return;
    }
    for (const listener of this.#listeners.get(message.method ?? '') ?? []) listener(message.params);
  }

  detached(): void {
    this.#gone = true;
    for (const waiter of this.#pending.values()) waiter.reject(new Gone('the target is gone'));
    this.#pending.clear();
    this.#listeners.clear();
  }
}

/**
 * Hold every request through the DevTools protocol, with the HTTP cache left on.
 *
 * A request is paused once before it leaves, and a read one again when its
 * answer arrives — from the server or from the cache, both pass. A request
 * cancelled while its answer is awaited never pauses a second time, so the wait
 * also ends on the network's own word that it failed.
 *
 * A frame another site serves can run in a process of its own, and the
 * page's session hears none of its requests. So every such frame is attached as
 * it appears, held before its first request, given the same interception, and
 * only then let go; a target inside it is reached the same way.
 *
 * A dedicated worker's requests pause in the interception of the frame that
 * started it, but the network's word on them — that one failed — comes only
 * from the worker's own target. So a worker is attached and held the same way,
 * and listened to with no interception of its own, as Playwright's routing
 * listens to it.
 *
 * One that cannot be held still runs, and `unreached` names it. One that goes
 * away ends every wait on its requests at once, since no answer to them is
 * coming and nothing will show them.
 *
 * Chromium only.
 */
export async function pauseByProtocol(
  page: Page,
  handle: (request: Paused) => Promise<void>,
  unreached: Unreached = () => {},
): Promise<Unpause> {
  const session: CDPSession = await page.context().newCDPSession(page);
  const root = intercept(session);
  await root.ready;

  return async () => {
    await root.close();
    root.forget(new Error('the observation was closed'));
    await session.detach().catch(() => {});
  };

  /**
   * Hold one target's requests, or, given the `holder` that pauses them, only
   * listen to them: a worker's.
   */
  function intercept(channel: Channel, holder?: Holder): Reach {
    // Each target that pauses requests numbers its own.
    const own: Holder = holder ?? { awaiting: new Map(), byNetworkId: new Map(), verdicts: new Map() };
    const { awaiting, byNetworkId, verdicts } = own;
    const pauses = holder === undefined;
    // A worker's requests on their way, by the network's id: the waits its going away ends.
    const asked = new Set<string>();
    // The targets reached through this one, while they live.
    const children = new Map<string, { readonly carried: Carried; reach?: Reach }>();

    if (!pauses) {
      channel.on('Network.requestWillBeSent', (event: { requestId: string }) => asked.add(event.requestId));
      channel.on('Network.loadingFinished', (event: { requestId: string }) => asked.delete(event.requestId));
    }
    channel.on('Fetch.requestPaused', (event: PausedEvent) => {
      if (event.responseStatusCode !== undefined || event.responseErrorReason !== undefined) {
        const waiter = awaiting.get(event.requestId);
        if (waiter !== undefined) waiter.resolve(event);
        else void channel.send('Fetch.continueRequest', { requestId: event.requestId }).catch(() => {});
        return;
      }
      void handle(pausedRequest(channel, event, own));
      // Asked again: what the failure left unread is read under the new pause.
      // Handled first, so the request is never between the two unread.
      if (event.networkId !== undefined) verdicts.get(event.networkId)?.resolve();
    });
    channel.on('Network.loadingFailed', (event: { requestId: string; errorText: string }) => {
      asked.delete(event.requestId);
      const requestId = byNetworkId.get(event.requestId);
      if (requestId !== undefined) awaiting.get(requestId)?.reject(new Error(event.errorText));
      verdicts.get(event.requestId)?.reject(new Error(event.errorText));
    });
    channel.on('Target.attachedToTarget', (event: AttachedEvent) => {
      const child = { carried: new Carried(channel, event.sessionId) } as { carried: Carried; reach?: Reach };
      children.set(event.sessionId, child);
      void adopt(channel, child, event, own);
    });
    channel.on('Target.receivedMessageFromTarget', (event: { sessionId: string; message: string }) => {
      children.get(event.sessionId)?.carried.receive(event.message);
    });
    channel.on('Target.detachedFromTarget', (event: { sessionId: string }) => {
      const child = children.get(event.sessionId);
      if (child === undefined) return;
      children.delete(event.sessionId);
      child.carried.detached();
      child.reach?.forget(new Gone('the target is gone'));
    });

    const reach: Reach = {
      ready: (async () => {
        // The network's events only for that failure. No body is buffered for
        // them: the answer is read from the paused request, never from here.
        await channel.send('Network.enable', { maxTotalBufferSize: 0, maxResourceBufferSize: 0, maxPostDataSize: 0 });
        if (pauses) await channel.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
        // Every child target is held at its start until it is let go below.
        await channel.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: false });
      })(),
      async close() {
        // First, so no target appears while the others are let go.
        await channel.send('Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false }).catch(() => {});
        await Promise.all([...children.values()].map(async (child) => child.reach?.close()));
        if (pauses) await channel.send('Fetch.disable').catch(() => {});
      },
      forget(error) {
        if (pauses) {
          for (const waiter of [...awaiting.values(), ...verdicts.values()]) waiter.reject(error);
          awaiting.clear();
          verdicts.clear();
        } else {
          // Only the worker's own: the frame that pauses them still lives.
          for (const networkId of asked) {
            const requestId = byNetworkId.get(networkId);
            if (requestId !== undefined) awaiting.get(requestId)?.reject(error);
            verdicts.get(networkId)?.reject(error);
          }
          asked.clear();
        }
        for (const child of children.values()) {
          child.carried.detached();
          child.reach?.forget(error);
        }
        children.clear();
      },
    };
    return reach;
  }

  async function adopt(
    parent: Channel,
    child: { readonly carried: Carried; reach?: Reach },
    event: AttachedEvent,
    holder: Holder,
  ): Promise<void> {
    const { type, url } = event.targetInfo;
    // The targets whose requests routing holds. A shared or service worker is
    // not the page's, and is only let go.
    const held = type === 'iframe' || type === 'worker';
    try {
      if (held) {
        child.reach = type === 'worker' ? intercept(child.carried, holder) : intercept(child.carried);
        await child.reach.ready;
      }
    } catch (error) {
      // Gone before it was reached has nothing left to hold.
      if (!(error instanceof Gone)) {
        unreached(`${url} could not be held (${messageOf(error)}), so its requests are absent from the environment key`);
      }
    } finally {
      await child.carried.send('Runtime.runIfWaitingForDebugger').catch(() => {});
      if (!held) await parent.send('Target.detachFromTarget', { sessionId: event.sessionId }).catch(() => {});
    }
  }

  function pausedRequest(channel: Channel, event: PausedEvent, { awaiting, byNetworkId, verdicts }: Holder): Paused {
    const { requestId, networkId } = event;
    // Answered once. A request whose target is gone needs no answer: there is
    // no one to give it to.
    let answered = false;
    const reply = async (method: string, params: object): Promise<void> => {
      if (answered) return;
      answered = true;
      await channel.send(method, params).catch(unlessGone);
    };
    return {
      url: event.request.url,
      resourceType: event.resourceType.toLowerCase(),
      headers: lowerCased(Object.entries(event.request.headers)),
      abort: async () => reply('Fetch.failRequest', { requestId, errorReason: 'Aborted' }),
      continue: async () => reply('Fetch.continueRequest', { requestId }),
      async fetch() {
        try {
          return await read();
        } catch (error) {
          unlessGone(error);
          return null;
        }
      },
      serve: async (contentType, body) =>
        reply('Fetch.fulfillRequest', {
          requestId,
          responseCode: 200,
          responseHeaders: [{ name: 'content-type', value: contentType }],
          body: Buffer.from(body).toString('base64'),
        }),
    };

    async function read(): Promise<Answered | null> {
      const answered = new Promise<PausedEvent>((resolve, reject) => awaiting.set(requestId, { resolve, reject }));
      if (networkId !== undefined) byNetworkId.set(networkId, requestId);
      let answer: PausedEvent;
      try {
        await channel.send('Fetch.continueRequest', { requestId, interceptResponse: true });
        answer = await answered;
      } finally {
        awaiting.delete(requestId);
        if (networkId !== undefined) byNetworkId.delete(networkId);
      }
      if (answer.responseErrorReason !== undefined) {
        if (networkId === undefined) throw new Error(answer.responseErrorReason);
        // Not yet a failure: the browser fails a dedicated worker's request once
        // and asks again, with nothing on the wire between. Passed on, the
        // failure ends in the network's own word on it, or in the next pause.
        const verdict = new Promise<void>((resolve, reject) => verdicts.set(networkId, { resolve, reject }));
        try {
          await reply('Fetch.continueRequest', { requestId });
          await verdict;
        } finally {
          verdicts.delete(networkId);
        }
        return null;
      }
      const status = answer.responseStatusCode ?? 200;
      if (status >= 300 && status < 400) {
        // The target is paused again as a request of its own, and read there.
        await channel.send('Fetch.continueRequest', { requestId });
        return null;
      }
      const body = (await channel.send('Fetch.getResponseBody', { requestId })) as {
        body: string;
        base64Encoded: boolean;
      };
      const listed = answer.responseHeaders ?? [];
      return {
        body: Buffer.from(body.body, body.base64Encoded ? 'base64' : 'utf8'),
        headers: lowerCased(listed.map(({ name, value }) => [name, value])),
        fulfill: async (served) =>
          reply('Fetch.fulfillRequest', {
            requestId,
            responseCode: status,
            // The length and the encoding described the bytes that arrived;
            // what is handed over is decoded, and may be a single frame.
            responseHeaders: listed.filter(({ name }) => !/^content-(length|encoding)$/i.test(name)),
            body: Buffer.from(served).toString('base64'),
          }),
        pass: async () => reply('Fetch.continueResponse', { requestId }),
      };
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function lowerCased(entries: readonly (readonly [string, string])[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of entries) headers[name.toLowerCase()] = value;
  return headers;
}
