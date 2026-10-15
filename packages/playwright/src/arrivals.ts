import type { Page, Request } from 'playwright';

/**
 * Name of the function a watched page calls to wait for the next arrival.
 *
 * Long for the reason `AGENT_GLOBAL` is: it shares a namespace with the
 * application.
 */
export const ARRIVAL_GLOBAL = '__variance_authority_arrival__';

/**
 * Requests that are a channel rather than a response. One stays open for as
 * long as the page does, so counting it would make every page that holds one
 * look as though something were still arriving.
 */
const CHANNELS = new Set(['eventsource', 'websocket']);

/**
 * Let the page ask whether anything it requested is still arriving, and wait
 * for it when something is.
 *
 * The page installs `globalThis[ARRIVAL_GLOBAL]`, which resolves `true` once
 * the next request in flight has finished or failed, and `false` at once when
 * none is. Asked by a page agent that is waiting on something only the outside
 * can settle — a hydration suspended on a chunk or a payload, a client that has
 * not created its root — so that the wait is as long as the wire is busy and
 * not a moment longer, with no clock deciding either.
 *
 * Every request the page sends, of every type, because whatever the page is
 * waiting on can be any of them: a module, a JSON payload, a stream. Watched
 * from the page's own events rather than from a route, so it costs nothing per
 * request and sees requests no route handler continues.
 *
 * A request that never ends — a long poll — keeps the answer `true` for as long
 * as it is open. A wait that follows it is following a page that is still
 * receiving, which is the truth about it; the channels that are open by design
 * are not counted.
 */
export async function watchArrivals(page: Page): Promise<void> {
  const inFlight = new Set<Request>();
  let waiters: Array<() => void> = [];

  const ended = (request: Request): void => {
    if (!inFlight.delete(request)) return;
    const woken = waiters;
    waiters = [];
    for (const wake of woken) wake();
  };

  page.on('request', (request) => {
    if (!CHANNELS.has(request.resourceType())) inFlight.add(request);
  });
  page.on('requestfinished', ended);
  page.on('requestfailed', ended);

  await page.exposeFunction(ARRIVAL_GLOBAL, async (): Promise<boolean> => {
    if (inFlight.size === 0) return false;
    await new Promise<void>((resolve) => waiters.push(resolve));
    return true;
  });
}
