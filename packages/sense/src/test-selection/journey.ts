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
import { channelFrom, JOURNEY_COOKIE, type Channel } from '@variance-authority/wire';
import { INSTRUMENTATION_ID } from '../instrument/index.js';
import { idOrder } from './instrumented-modules.js';
import { UNATTRIBUTED, type JourneyAccount } from './stitch.js';
import type { ExecutedModule } from './probes.js';
import probeLog from '../instrument/probe-log.cjs';

/**
 * The join, re-exported so one import serves a driver: a participant that
 * stitches also mints, and splitting that across two entry points would be a
 * file layout leaking into somebody else's import block.
 */
export {
  journeyReportFrom,
  stitchJourneys,
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

/**
 * Whether this process reports at all. Absent, a head installs nothing.
 *
 * Any value will do — where to report is a fact about the request, carried in by
 * whoever drove it, and not something an environment can know in advance.
 */
export const JOURNEY_VARIABLE = 'VARIANCE_AUTHORITY_JOURNEYS';

/** What a head calls itself, when the process is started rather than configured. */
export const JOURNEY_HEAD_VARIABLE = 'VARIANCE_AUTHORITY_HEAD';


/** One execution of one subject, as it crosses the wire: opaque, and nothing else. */
export function mintJourney(): string {
  return randomUUID();
}

/**
 * Read a journey back out of a `Cookie` header.
 *
 * The header is the one place a head is guaranteed to have, whatever framework
 * sits above it. A head with a request-scoped cookie accessor of its own should
 * use that and pass the value straight to {@link JourneyCollector.enter}.
 */
export function journeyOf(cookieHeader: string | undefined): string | undefined {
  if (cookieHeader === undefined) return undefined;
  for (const pair of cookieHeader.split(';')) {
    const equals = pair.indexOf('=');
    if (equals < 0) continue;
    if (pair.slice(0, equals).trim() !== JOURNEY_COOKIE) continue;
    const value = pair.slice(equals + 1).trim();
    return value.length === 0 ? undefined : value;
  }
  return undefined;
}

export interface JourneyCollectorOptions {
  /**
   * What this head calls itself. Defaults to {@link JOURNEY_HEAD_VARIABLE}, then
   * `head`. It is the `label` its build gave `testSelectionProbes()`: an ordinal
   * means something only against the inventory that minted it.
   */
  readonly head?: string;
  /**
   * Whether to install the engine at all. Defaults to whether
   * {@link JOURNEY_VARIABLE} is set. False installs nothing and makes
   * {@link JourneyCollector.enter} the identity — which is how this call
   * survives being left in a production build.
   */
  readonly enabled?: boolean;
}

/** A head's participation in a run, or its cheap absence. */
export interface JourneyCollector {
  /** False when nothing said this process reports: nothing installed, nothing held. */
  readonly collecting: boolean;
  readonly head: string;
  /**
   * Run `body` as part of the execution the request belongs to, so everything it
   * enters — including whatever it awaits — is attributed to that subject and to
   * no other.
   *
   * `carried` is the request's `Cookie` header; a head with a request-scoped
   * cookie accessor of its own may pass the pairs it holds joined the same way.
   * A request carrying neither an execution nor a way home is honest and is not
   * an error: it is something the run did not drive, and its crossings go to the
   * unattributed bucket rather than to whichever subject happened to be nearby.
   */
  readonly enter: <Result>(carried: string | undefined, body: () => Result) => Result;
  /** Report everything held so far, including crossings still inside open scopes. */
  readonly flush: () => Promise<void>;
  /** Stop collecting and restore what was on the global before. */
  readonly close: () => Promise<void>;
}

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
 */
export function collectJourneys(options: JourneyCollectorOptions = {}): JourneyCollector {
  const head = options.head ?? process.env[JOURNEY_HEAD_VARIABLE] ?? 'head';
  const enabled = options.enabled ?? process.env[JOURNEY_VARIABLE] !== undefined;
  if (!enabled) {
    return {
      collecting: false,
      head,
      enter: (_carried, body) => body(),
      flush: async () => {},
      close: async () => {},
    };
  }

  const store = new AsyncLocalStorage<string>();
  const channels = new Map<string, Channel>();
  const sending = new Set<Promise<void>>();
  let lost = 0;
  const depth = new Map<string, number>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, '__VA__');

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

  const report = (journey: string, over: Channel | undefined): void => {
    const bucket = buckets.get(journey);
    buckets.delete(journey);
    if (bucket === undefined) return;
    // A module a request was the first to need evaluated inside that journey,
    // and what it did then is every subject's: the driver folds its `shared`
    // in beside the process's own unattributed crossings.
    const entered: ExecutedModule[] = engine.lists(engine.close(bucket), false);
    if (entered.length === 0) return;
    if (over === undefined) return;
    const account: JourneyAccount = {
      version: 1,
      instrumentation: INSTRUMENTATION_ID,
      head,
      scope: journey === UNATTRIBUTED ? 'process' : 'journey',
      ...(lost === 0 ? {} : { lost }),
      modules: entered.sort((left, right) => idOrder(left.id, right.id)),
    };
    // Now, rather than once at shutdown. A driver stitches while the service is
    // still serving, and an account that waited for teardown would be read by
    // nobody: `webServer` teardown happens after the workers that needed it have
    // already recorded.
    const sent = over
      .deliver('journeys', account)
      .catch(() => {
        lost += 1;
      })
      .finally(() => {
        sending.delete(sent);
      });
    sending.add(sent);
  };

  const release = (journey: string): void => {
    const open = (depth.get(journey) ?? 1) - 1;
    if (open > 0) {
      depth.set(journey, open);
      return;
    }
    depth.delete(journey);
    const over = channels.get(journey);
    channels.delete(journey);
    report(journey, over);
    // Whatever the process did outside any journey goes home on the address that
    // is open right now. It belongs to every subject, so which one carries it is
    // nobody's business but the driver's, and the driver unions them.
    report(UNATTRIBUTED, over);
  };

  const flush = async (): Promise<void> => {
    // `report` deletes the key it was handed, which is the one being visited —
    // the only mutation a Map iteration is allowed to see and go on.
    for (const journey of buckets.keys()) report(journey, channels.get(journey));
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
      const channel = channelFrom(carried);
      const journey = channel?.journey;
      if (channel === undefined || journey === undefined) return body();
      channels.set(journey, channel);
      depth.set(journey, (depth.get(journey) ?? 0) + 1);
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

function isThenable(value: unknown): value is Promise<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function' &&
    typeof (value as { finally?: unknown }).finally === 'function'
  );
}
