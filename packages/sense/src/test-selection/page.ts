/**
 * `@variance-authority/sense/page` — a page that reports what it ran.
 *
 * A probed page keeps what it entered until something drains it, and used by
 * hand it has no driver. So the page is its own: it names an execution at
 * load and at each click or submit, leaves the two cookies a driver leaves,
 * and sends what it entered to a watcher as a head called `page`. A server
 * head reads those cookies as it reads a driver's, so one click lists the
 * page and the server under one id, and no request is wrapped to carry it.
 *
 * Its own code is in no account. A build places no probe under `node_modules`
 * or `dist`, which is where an application finds this module.
 */
import { JOURNEY_COOKIE, RETURN_COOKIE, channelFrom, channelTo } from '@variance-authority/wire';
import { DRIVEN_GLOBAL, EXECUTION_GLOBAL } from './execution-global.js';
import type { ExecutedModule, ExecutionCollector } from './probes.js';
import type { JourneyAccount } from './stitch.js';

// compass: variance-authority.reach.journey

/** A target of events, as far as this listens. */
interface Listened {
  addEventListener(type: string, listener: () => void, capture?: boolean): void;
}

/** The browser this reads. Spelled here, since the DOM's types would retype every `fetch` this package compiles. */
interface Browser extends Listened {
  readonly document: { cookie: string };
  readonly navigator: { sendBeacon?(url: string, body: string): boolean };
}

/** What a page is listed under, beside the heads its requests reached. */
const HEAD = 'page';

/** How long, in milliseconds, what a page ran can wait for the next click before it is sent. */
const CADENCE = 500;

/** The documents that report, each once: an effect a framework runs twice calls twice. */
const reporting = new WeakSet<object>();

/** One execution: opaque, and minted without `randomUUID`, which a page served over plain http lacks. */
const mint = (): string => Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');

/**
 * Report what this page runs to the watcher at `watcher`, the address
 * `variance watch` prints. Call it once, in the browser, when the page starts.
 *
 * Each load is one execution, and so is each click or submit; a click and the
 * submit it causes are one. A request the page sends is listed under the
 * execution before it, by any server whose handler runs inside
 * `collectJourneys().enter`. Given no address, an empty one, or one that is
 * not http on this machine, it installs nothing and sends nothing. Nor does
 * it on a page a test drives, or one that reports already; and it stops for
 * good when a test starts to drive the page.
 */
export function reportPage(watcher: string | undefined): void {
  const home = watcher === undefined || watcher === '' ? undefined : channelTo(watcher, HEAD)?.home;
  if (home === undefined) return;

  const browser = globalThis as unknown as Browser & Record<string, ExecutionCollector | true | undefined>;
  let journey = '';
  let yielded = false;
  // A driver owns the page and what its collector holds. It says so itself, or its cookies, which answer somewhere else, do.
  const driven = (): boolean => {
    if (browser[DRIVEN_GLOBAL] === true) return true;
    const led = channelFrom(browser.document.cookie);
    return led !== undefined && led.home !== home;
  };
  const leave = (name: string, value: string, kept = ''): void => {
    browser.document.cookie = `${name}=${value}; Path=/; SameSite=Lax${kept}`;
  };
  const name = (): void => {
    journey = mint();
    leave(JOURNEY_COOKIE, journey);
    leave(RETURN_COOKIE, encodeURIComponent(`${home}/${journey}`));
  };

  const forget = (): void => {
    if (!browser.document.cookie.includes(`${JOURNEY_COOKIE}=${journey}`)) return;
    leave(JOURNEY_COOKIE, '', '; Max-Age=0');
    leave(RETURN_COOKIE, '', '; Max-Age=0');
  };
  // Asked before anything is drained or named, since a driver may come to a page already running: from then on
  // what the collector holds is the driver's, and a server told this page's execution would report for no page.
  const mine = (): boolean => {
    if (yielded) return false;
    if (!driven()) return true;
    yielded = true;
    forget();
    return false;
  };

  const flush = (): void => {
    if (!mine()) return;
    const journal = (browser[EXECUTION_GLOBAL] as ExecutionCollector | undefined)?.drain();
    if (journal === undefined || journal.modules.length === 0) return;
    // A beacon and not the wire's `report`: a JSON `fetch` to another origin is
    // preflighted, which the watcher does not answer, and it dies with the page.
    // A browser refuses a beacon once about 64 KiB of them are on their way, which
    // a page of a few hundred modules exceeds, so a refused one goes as a request no preflight precedes.
    const send = (scope: JourneyAccount['scope'], modules: readonly ExecutedModule[]): void => {
      const account: JourneyAccount = { version: 1, instrumentation: journal.instrumentation, head: HEAD, scope, modules };
      const to = `${home}/${journey}/journeys`;
      const body = JSON.stringify(account);
      if (browser.navigator.sendBeacon?.(to, body) === true) return;
      void fetch(to, { method: 'POST', body, mode: 'no-cors' }).catch(() => {});
    };
    send('journey', journal.modules);
    // What ran while a module evaluated is no one execution's; a watcher leaves it out of this one, so it is said apart, as a server head says it.
    const loading = journal.modules.filter((module) => module.shared.length > 0);
    if (loading.length > 0) send('process', loading.map((module) => ({ id: module.id, hits: module.shared, shared: [] })));
  };
  let turned = false;
  // Only a boundary: what ran before this interaction is the execution before it. The event is not read.
  const turn = (): void => {
    if (turned) return;
    turned = true;
    // One thing done is several events in one task: a button's click and the submit it causes. The next task is the next thing done.
    setTimeout(() => {
      turned = false;
    });
    flush();
    if (mine()) name();
  };
  // The request that replaces this document has left with the cookies by now, so they go with the document: kept, every
  // page on this machine would send a dead execution. Not when the next document has already named its own.
  const depart = (): void => {
    flush();
    forget();
  };
  // An observer does not break its subject: where a cookie cannot be left or nothing can be sent, the page runs on unreported.
  const quietly = (act: () => void) => (): void => {
    try {
      act();
    } catch {
      // Unreported, and the application is not told.
    }
  };

  try {
    if (reporting.has(browser.document)) return;
    if (driven()) return;
    name();
  } catch {
    return;
  }
  reporting.add(browser.document);
  // On the window, where an event is heard first: a handler the application puts there later runs under this click's execution.
  browser.addEventListener('click', quietly(turn), true);
  browser.addEventListener('submit', quietly(turn), true);
  // Leaving starts before the document goes, and by then the collector has kept what is left for the next document,
  // which reports it as its load. So what a click ran is sent as the page starts to leave; when it
  // goes, only a page the browser keeps for the back button has anything left.
  browser.addEventListener('beforeunload', quietly(flush));
  browser.addEventListener('pagehide', quietly(depart));
  // A cadence, since nothing says a click has finished running: its promises settle whenever they do, and a reader asks meanwhile.
  setInterval(quietly(flush), CADENCE);
}
