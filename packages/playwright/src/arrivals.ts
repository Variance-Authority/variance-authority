import type { Page, Request } from 'playwright';

/**
 * Name of the function a watched page calls to wait for the next arrival.
 *
 * Long for the reason `AGENT_GLOBAL` is: it shares a namespace with the
 * application.
 */
export const ARRIVAL_GLOBAL = '__variance_authority_arrival__';

/**
 * Requests nothing a render waits on is carried by.
 *
 * A channel stays open for as long as the page does, so counting one would make
 * every page that holds one look as though something were still arriving; a
 * media element is one too, streaming for as long as it plays. A font or an
 * image is an asset: React neither hydrates nor creates a root on one, and the
 * stages that read assets wait for each and name the one that never answers.
 * Counting a stalled font here would hold the wait ahead of the stage that says
 * which font it was.
 */
const NOT_AWAITED = new Set(['eventsource', 'font', 'image', 'media', 'websocket']);

/** What a page waits on: every request that can carry a render's input, or only scripts. */
type Awaited = 'any' | 'script';

/** What each watched page has asked for and not yet received, and what its agent is waiting on. */
interface Watch {
  readonly inFlight: ReadonlySet<Request>;
  readonly waiting: ReadonlyArray<{ readonly of: Awaited }>;
}

const watched = new WeakMap<Page, Watch>();

function counted(request: Request, of: Awaited): boolean {
  return of === 'any' || request.resourceType() === 'script';
}

/**
 * The URLs a watched page's agent is waiting on, oldest first: the requests
 * still arriving of the kind it asked for, while it waits. None for a page
 * nobody watches, or whose agent is not waiting on the wire.
 *
 * What a run that stopped while a page agent waited on the wire has to say
 * about it: the request that kept it waiting. A request that is open while the
 * agent is doing something else, a long poll beside a failed read, is not why
 * it stopped.
 */
export function stillArriving(page: Page): readonly string[] {
  const watch = watched.get(page);
  if (watch === undefined || watch.waiting.length === 0) return [];
  const of: Awaited = watch.waiting.some((waiter) => waiter.of === 'any') ? 'any' : 'script';
  return [...watch.inFlight].filter((request) => counted(request, of)).map((request) => request.url());
}

/**
 * Let the page ask whether anything it requested is still arriving, and wait
 * for it when something is.
 *
 * The page installs `globalThis[ARRIVAL_GLOBAL]`, which resolves `true` once
 * the next request in flight has finished or failed, and `false` at once when
 * none is. Called with `'script'`, it answers only for scripts in flight: a
 * page waiting for a renderer to arrive is waiting on nothing else. Asked by a
 * page agent that is waiting on something only the outside can settle — a
 * hydration suspended on a chunk or a payload, a client that has not created
 * its root — so that the wait is as long as the wire is busy and not a moment
 * longer, with no clock deciding either.
 *
 * Every request the page sends that can carry what a render waits on, because
 * that can be any of them: a module, a JSON payload, a stylesheet, a stream.
 * Watched from the page's own events rather than from a route, so it costs
 * nothing per request and sees requests no route handler continues.
 *
 * A request that never ends — a long poll — keeps the answer `true` for as long
 * as it is open. A wait that follows it is following a page that is still
 * receiving, which is the truth about it, and a run that ends it names the
 * request ({@link stillArriving}). Channels open by design, and assets, are
 * not counted.
 */
export async function watchArrivals(page: Page): Promise<void> {
  const inFlight = new Set<Request>();
  let waiters: Array<{ readonly of: Awaited; wake(): void }> = [];
  watched.set(page, {
    inFlight,
    get waiting() {
      return waiters;
    },
  });

  const ended = (request: Request): void => {
    if (!inFlight.delete(request)) return;
    const woken = waiters;
    waiters = [];
    for (const waiter of woken) waiter.wake();
  };

  page.on('request', (request) => {
    if (!NOT_AWAITED.has(request.resourceType())) inFlight.add(request);
  });
  page.on('requestfinished', ended);
  page.on('requestfailed', ended);

  await page.exposeFunction(ARRIVAL_GLOBAL, async (of?: unknown): Promise<boolean> => {
    const kind: Awaited = of === 'script' ? 'script' : 'any';
    if (![...inFlight].some((request) => counted(request, kind))) return false;
    await new Promise<void>((resolve) => waiters.push({ of: kind, wake: resolve }));
    return true;
  });
}
