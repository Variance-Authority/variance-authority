/**
 * `@variance-authority/sense/journey` — the same instrument in a process that is
 * not a realm.
 *
 * [`journal.ts`](./journal.ts) next door carries the instrument into a browser:
 * one page, one subject at a time, torn down between them, so its log needs no
 * key and the driver reads it back through `page.evaluate`. A service
 * is neither of those things. It outlives every subject in the run, it answers
 * several of them at once, and nobody can evaluate inside it. One log in a
 * server process is shared mutable state across concurrent logical flows, and
 * draining it at request boundaries does not rescue it — a streamed response
 * flushes after its handler returned, a floating promise settles two requests
 * later, and a time window is not a journey. The crossing goes to whoever was
 * open at that moment; the subject that caused it loses it, and the next diff to
 * land there skips that subject without a word.
 *
 * So the scope is logical, which in Node means async context, and the key on the
 * wire is a **journey**: one opaque id per execution of one subject, minted by
 * the driver, carried by a cookie, read back by whatever the head already has.
 * This is distributed tracing in the vocabulary this repository already uses —
 * the driver is one participant among several, each reports what it entered
 * under the id, and the join happens afterwards on the id alone. The subject's
 * *name* never leaves the driver.
 *
 * Three parts, and each is somebody's:
 *
 * 1. **The head** ({@link collectJourneys}) runs inside the service. It installs
 *    a journey-keyed engine behind `globalThis.__VA__` and reports one account
 *    per journey the moment that journey's last scope settles. Told nothing, it
 *    installs nothing: the same call ships to production and costs an `if`.
 * 2. **The wire** is `@variance-authority/wire`, shared with
 *    `@variance-authority/event` down to the cookie: one id per execution, one
 *    way home, and nothing written down. Same-origin is the filter, the browser
 *    enforces it, cookies ignore ports, and a bare UUID has no character any
 *    engine encodes differently. An account is **acknowledged** rather than
 *    fired and forgotten, because the two instruments on that wire fail in
 *    opposite directions: a lost announcement is a wait that times out where
 *    somebody is reading, and a lost account is a subject skipped in silence.
 * 3. **The join** ({@link stitchJourneys}) runs in the driver, which is the only
 *    participant that knows which subject each journey was — and the only one
 *    that writes anything down. A head persists nothing at all: it holds a log
 *    for as long as a scope is open and reports them to whoever left an address.
 *
 * ## The probe does not change, and this is why
 *
 * The emitted probe logs into whichever bucket the realm's engine holds
 * ([`instrument`](../instrument/index.ts)), and an engine made for an async
 * scope asks a **resolver** on the root's `s` which bucket owns each crossing.
 * Here the resolver reads the journey from the async store, so the bucket
 * switches at precisely the crossings where two journeys interleave inside one
 * module, and nowhere else. Swapping a plain
 * global at the request boundary instead is the shape that reads correctly under
 * one request at a time and silently misattributes under load.
 *
 * ## A head that was not there
 *
 * Every head a run declares must report at least once. A service that failed to
 * start, was built without probes, or was never wired contributes no crossings
 * at all — and absence is what the journey ground already reads as *unknown*.
 * The distinction this file exists to keep is between *the head executed
 * nothing* and *the head was not watched*, and one report anywhere in the run
 * settles it. Silence does not narrow: it retires every observation in the run,
 * so the ground declines wholesale rather than skipping subjects on evidence
 * half of which never arrived.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { codeUnitOrder } from '@variance-authority/core/segment';
import {
  channelFrom,
  channelTo,
  JOURNEY_COOKIE,
  WATCHER_VARIABLE,
  type Channel,
} from '@variance-authority/wire';
import { INSTRUMENTATION_ID } from '../instrument/identity.js';
import { commonCrossings } from './journey-common.js';
import { UNATTRIBUTED, type JourneyAccount } from './stitch.js';
import type { ExecutedModule } from './probes.js';
import probeLists from '../instrument/probe-lists.cjs';
import probeLog from '../instrument/probe-log.cjs';
import { isThenable, TOLD, writeParts } from './journey-parts.js';
import { journeyOf, type JourneyTrace } from './journey-carrier.js';
import {
  JOURNEY_HEAD_VARIABLE,
  JOURNEY_PARTS_VARIABLE,
  JOURNEY_VARIABLE,
  type JourneyCollector,
  type JourneyCollectorOptions,
} from './journey-options.js';

/**
 * The join, re-exported so one import serves a driver: a participant that
 * stitches also mints, and splitting that across two entry points would be a
 * file layout leaking into somebody else's import block.
 */
export {
  journeyReportFrom,
  stitchJourneys,
  unsettledScopes,
  type JourneyAccount,
  type JourneyReport,
  type StitchedJourneys,
  type StitchJourneysOptions,
} from './stitch.js';

/**
 * The cookie a journey rides on, named by the wire rather than here.
 *
 * The id is the wire's identity and not this instrument's: an announcement and
 * an account are two things said about *the same execution*, so there is one
 * cookie and both read it.
 */
export { JOURNEY_COOKIE };

/** What carries a journey across a fence: the cookie, or the application's trace. */
export {
  journeyOf,
  openTelemetry,
  sentry,
  type JourneyTrace,
  type OpenTelemetryApi,
  type SentrySdk,
} from './journey-carrier.js';

/** Where a service with no host filesystem sends its parts. */
export { receiveParts, type PartsReceiver } from './parts-receiver.js';

/** What a head is told and what it hands back. */
export {
  JOURNEY_HEAD_VARIABLE,
  JOURNEY_PARTS_VARIABLE,
  JOURNEY_VARIABLE,
  type JourneyCollector,
  type JourneyCollectorOptions,
} from './journey-options.js';

/**
 * How many journeys a head remembers the way home for after their scopes
 * released. A long-lived service answers every run pointed at it, and one entry
 * per test attempt is what a promise left running needs to still be heard.
 */
const HOMES = 4096;

/** One execution of one subject, as it crosses the wire: opaque, and nothing else. */
export function mintJourney(): string {
  return randomUUID();
}

const INSTALLED: unique symbol = Symbol.for('variance-authority.journeys');

type Told = JourneyCollector & { readonly [TOLD]?: (trace: JourneyTrace) => void };

const untraceable = (trace: JourneyTrace): string =>
  `a ${trace.name} trace carries the journey and no way home, so a head it feeds writes parts: ` +
  `set \`parts\` or ${JOURNEY_PARTS_VARIABLE}`;

/**
 * Install the journey-keyed collector in this process.
 *
 * ```js
 * import { collectJourneys } from '@variance-authority/sense/journey';
 *
 * const journeys = collectJourneys();
 * server.on('request', (request, response) =>
 *   journeys.enter(request.headers.cookie, () => handle(request, response)));
 * ```
 *
 * One line, and it is the whole of the extra setup a service needs — plus
 * forwarding the cookie on any request it makes onward, which is the only way
 * anything past the first hop is ever attributed.
 *
 * A realm holds one collector. A bundle whose build installed it before any
 * instrumented module (`testSelectionProbes({ journeys: true })`) gets that
 * one back from this call, options and all, until it is closed.
 */
export function collectJourneys(options: JourneyCollectorOptions = {}): JourneyCollector {
  const realm = globalThis as { [INSTALLED]?: Told };
  const installed = realm[INSTALLED];
  if (installed !== undefined) {
    if (options.trace !== undefined) {
      const tell = installed[TOLD];
      if (tell === undefined) throw new Error(untraceable(options.trace));
      tell(options.trace);
    }
    return installed;
  }
  const collector = installJourneys(options);
  if (!collector.collecting) return collector;
  const held: Told = {
    ...collector,
    close: async () => {
      if (realm[INSTALLED] === held) delete realm[INSTALLED];
      await collector.close();
    },
  };
  realm[INSTALLED] = held;
  return held;
}

function installJourneys(options: JourneyCollectorOptions): JourneyCollector {
  const head = options.head ?? process.env[JOURNEY_HEAD_VARIABLE] ?? 'head';
  const parts = options.parts ?? process.env[JOURNEY_PARTS_VARIABLE];
  if (parts !== undefined && options.enabled !== false) return writeParts(head, parts, journeyOf, options.trace);
  const enabled = options.enabled ?? process.env[JOURNEY_VARIABLE] !== undefined;
  if (enabled && options.trace !== undefined) throw new Error(untraceable(options.trace));
  if (!enabled) {
    return {
      collecting: false,
      head,
      enter: (_carried, body) => body(),
      flush: async () => {},
      close: async () => {},
    };
  }

  // Empty is unset, as a run reads it: an unset variable interpolated into an environment arrives empty.
  const watcher = (options.watcher ?? process.env[WATCHER_VARIABLE]) || undefined;
  // Said now: a head that tells an address nothing looks like a quiet application.
  const watching = watcher === undefined ? undefined : channelTo(watcher, UNATTRIBUTED);
  const watched = watching?.home;
  if (watcher !== undefined && watched === undefined) {
    throw new Error(`collectJourneys cannot report to the watcher address ${JSON.stringify(watcher)}: it must be an http address on this machine, as \`variance watch\` prints it.`);
  }
  const store = new AsyncLocalStorage<string>();
  const channels = new Map<string, Channel>();
  const sending = new Set<Promise<void>>();
  // Counted apart: a report the watcher missed is no test's loss, nor a test's the watcher's.
  const lost = { watcher: 0, drivers: 0 };
  const depth = new Map<string, number>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, '__VA__');
  // The watcher is told a request's own regions as that request's, so its ledger leaves them out.
  const [all, apart] = [commonCrossings(HOMES), commonCrossings(1)];
  const keep: typeof all.keep = (modules, of) => (all.keep(modules, of), apart.keep(modules, of));
  const since = (home: string): ExecutedModule[] | undefined => (home === watched ? apart : all).since(home);

  // One bucket per journey, and the root asks the store on every probe, which
  // is what lets two concurrent requests each keep their own. See
  // `instrument/probe-log.cts` for what a switch between them costs.
  const engine = probeLog.createEngine(true);
  type Bucket = ReturnType<typeof engine.open>;
  const buckets = new Map<string, Bucket>();
  const bucketFor = (journey: string): Bucket => {
    let bucket = buckets.get(journey);
    if (bucket === undefined) {
      bucket = engine.open(journey);
      buckets.set(journey, bucket);
      if (journey !== UNATTRIBUTED && !depth.has(journey)) straggle(journey);
    }
    return bucket;
  };
  // The last answer, kept: consecutive probes almost always share a journey,
  // and a string compare is cheaper than a `Map.get`.
  let lastJourney = UNATTRIBUTED;
  let lastBucket = bucketFor(UNATTRIBUTED);
  engine.scope((): Bucket => {
    const journey = store.getStore() ?? UNATTRIBUTED;
    if (journey !== lastJourney || lastBucket.closed) {
      lastJourney = journey;
      lastBucket = bucketFor(journey);
    }
    return lastBucket;
  });

  const send = (over: Channel, account: Omit<JourneyAccount, 'version' | 'instrumentation' | 'head' | 'lost'>): void => {
    const to = over.home === watched ? 'watcher' : 'drivers';
    const sent = over
      .deliver('journeys', {
        version: 1,
        instrumentation: INSTRUMENTATION_ID,
        head,
        ...(lost[to] === 0 ? {} : { lost: lost[to] }),
        ...account,
      } satisfies JourneyAccount)
      .catch(() => {
        lost[to] += 1;
      })
      .finally(() => {
        sending.delete(sent);
      });
    sending.add(sent);
  };

  /**
   * Report what one journey entered. `settled` is how many of the scopes this
   * head said it opened for that journey the account closes; the driver waits
   * for every one of them before it joins anything.
   */
  const report = (journey: string, over: Channel | undefined, settled = 0): void => {
    const bucket = buckets.get(journey);
    buckets.delete(journey);
    const entered: ExecutedModule[] =
      bucket === undefined ? [] : probeLists.lists(engine.close(bucket), false);
    // What the process did outside any journey is every subject's, and so is
    // what a module did while a request was the first to need it evaluated.
    // Both are kept for every driver, not only the one this account reaches.
    if (journey === UNATTRIBUTED) {
      keep(entered, (module) => module.hits);
      return;
    }
    keep(entered, (module) => module.shared);
    if (over === undefined) return;
    // A request nobody drove is the process's to every driver, as it is with no watcher.
    if (over.home === watched) all.keep(entered, (module) => module.hits);
    // An empty account still goes when it closes a scope, because the driver
    // is waiting on that scope and cannot tell *entered nothing* from *not yet*.
    if (entered.length === 0 && settled === 0) return;
    // Now, rather than once at shutdown. A driver stitches while the service is
    // still serving, and an account that waited for teardown would be read by
    // nobody: `webServer` teardown happens after the workers that needed it have
    // already recorded.
    send(over, {
      scope: 'journey',
      ...(settled === 0 ? {} : { settled }),
      modules: entered.sort((left, right) => codeUnitOrder(left.id, right.id)),
    });
  };

  const catchUp = (over: Channel): void => {
    const modules = since(over.home);
    if (modules !== undefined) send(over, { scope: 'process', modules });
  };

  const release = (journey: string): void => {
    const open = (depth.get(journey) ?? 1) - 1;
    if (open > 0) {
      depth.set(journey, open);
      return;
    }
    depth.delete(journey);
    // The way home is kept past the scope, since a promise the handler started
    // and did not return still runs as this request; see `straggle`.
    const over = channels.get(journey);
    report(journey, over, 1);
    // A request nobody drove and still open is the process's to this driver too, so far.
    if (watched !== undefined && over?.home !== watched) for (const [open, home] of channels) if (home.home === watched && buckets.has(open)) report(open, home);
    report(UNATTRIBUTED, over);
    // Whichever journey carries it, the driver unions it into every subject.
    if (over !== undefined) catchUp(over);
  };

  /**
   * A crossing for a journey whose scope already released: a promise the
   * handler started and did not return, still running in the request's context.
   * It belongs to that request, so it goes home as a scope of its own, opened
   * now and settled on the next turn of the loop. One whose way home was
   * forgotten counts as lost, which the driver reads as an account that never
   * arrived.
   */
  function straggle(journey: string): void {
    const over = channels.get(journey);
    if (over === undefined) {
      lost.drivers += 1;
      return;
    }
    depth.set(journey, 1);
    // Off the probe's own stack: this runs inside an instrumented call.
    queueMicrotask(() => send(over, { scope: 'journey', opened: 1, modules: [] }));
    setImmediate(() => release(journey));
  }

  const flush = async (): Promise<void> => {
    // A scope still open is closed by this account, since nothing will report
    // it again; `report` deletes the bucket it was handed, which is the one
    // being visited — the only mutation a Map iteration may see and go on.
    const journeys = new Set([...buckets.keys(), ...depth.keys()]);
    for (const journey of journeys) report(journey, channels.get(journey), depth.has(journey) ? 1 : 0);
    // What ran outside every request since the last one settled: no later request will carry it.
    for (const over of [...journeys].map((journey) => channels.get(journey)).concat(watching)) if (over !== undefined) catchUp(over);
    await Promise.all(sending);
  };

  // A data property on the realm, with the scope one level in on the root. An
  // accessor on the realm defeats the inline cache the probe is made of; see
  // `instrument/index.ts` for what that costs a hit.
  Object.defineProperty(globalThis, '__VA__', {
    configurable: true,
    writable: true,
    enumerable: false,
    value: engine.root,
  });

  return {
    collecting: true,
    head,
    enter: <Result,>(carried: string | undefined, body: () => Result): Result => {
      const driven = channelFrom(carried);
      // Nobody drove it, so it is its own execution, unless it already runs inside one.
      const channel =
        driven?.journey !== undefined || watcher === undefined || store.getStore() !== undefined
          ? driven
          : channelTo(watcher, mintJourney());
      const journey = channel?.journey;
      if (channel === undefined || journey === undefined) return body();
      // Most recent last, so the one forgotten first is the one released longest ago.
      channels.delete(journey);
      channels.set(journey, channel);
      if (channels.size > HOMES) channels.delete(channels.keys().next().value!);
      const opening = !depth.has(journey);
      depth.set(journey, (depth.get(journey) ?? 0) + 1);
      // Said before the body runs, so the driver knows to wait for this scope
      // however long after the response it settles. Without it, an account
      // that lands after the driver joined is lost without a word.
      if (opening) send(channel, { scope: 'journey', opened: 1, modules: [] });
      let done: Result;
      try {
        done = store.run(journey, body);
      } catch (error) {
        release(journey);
        throw error;
      }
      // A handler's scope ends when what it returned settles, not when it
      // returns: everything after an `await` is instrumented too, and that is
      // the half a request-boundary drain loses.
      if (isThenable(done)) return done.finally(() => release(journey)) as Result;
      release(journey);
      return done;
    },
    flush,
    close: async () => {
      await flush();
      if (previous === undefined) delete (globalThis as Record<string, unknown>)['__VA__'];
      else Object.defineProperty(globalThis, '__VA__', previous);
    },
  };
}
