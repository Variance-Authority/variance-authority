// compass: variance-authority.reach.journey
/**
 * What a head is told and what it hands back: the variables a started process
 * reads, the options a configured one passes, and the collector either gets.
 * [`journey.ts`](./journey.ts) installs the head these describe.
 */

import type { JourneyTrace } from './journey-carrier.js';

/**
 * Whether this process reports at all. Absent, a head installs nothing.
 *
 * Any value will do — where to report is a fact about the request, carried in by
 * whoever drove it, and not something an environment can know in advance.
 */
export const JOURNEY_VARIABLE = 'VARIANCE_AUTHORITY_JOURNEYS';

/** What a head calls itself, when the process is started rather than configured. */
export const JOURNEY_HEAD_VARIABLE = 'VARIANCE_AUTHORITY_HEAD';

/**
 * The directory a head writes its parts to, when the process is started rather
 * than configured. Set, the head writes what each journey ran there and says
 * nothing over the wire.
 */
export const JOURNEY_PARTS_VARIABLE = 'VARIANCE_AUTHORITY_PARTS';

export interface JourneyCollectorOptions {
  /**
   * What this head calls itself. Defaults to {@link JOURNEY_HEAD_VARIABLE}, then
   * `head`. It is the `label` its build gave `testSelectionProbes()`.
   */
  readonly head?: string;
  /**
   * Whether to install the engine at all. Defaults to whether
   * {@link JOURNEY_VARIABLE} is set. False installs nothing and makes
   * {@link JourneyCollector.enter} the identity — which is how this call
   * survives being left in a production build.
   */
  readonly enabled?: boolean;
  /**
   * A directory to write this head's parts to, or the `http(s)://` address of
   * a `receiveParts` that writes them for a runtime with no host
   * filesystem. Defaults to
   * {@link JOURNEY_PARTS_VARIABLE}. A part is what one journey ran here, as a
   * case frame owned by the journey id alone; the case that handed the id out
   * is joined to it when its run is finalized. Set, it enables the head.
   */
  readonly parts?: string;
  /**
   * The application's own tracing, which carries the journey as its trace id:
   * `sentry(Sentry)` or `openTelemetry(api)`, handed the SDK the application
   * initialized. Set, the head asks it which journey is running wherever
   * {@link JourneyCollector.enter} did not say, so a service whose tracing
   * continues the incoming trace needs no `enter`. A trace carries an id and no
   * way home, so the head writes {@link JourneyCollectorOptions.parts} or
   * reports to a {@link JourneyCollectorOptions.watcher}, and refuses to start
   * with neither. A watcher lists one execution per trace: one per page view
   * where a browser SDK propagates its trace. With parts sent over HTTP,
   * `enter(undefined, ...)` holds each request open until its frame is sent.
   */
  readonly trace?: JourneyTrace;
  /**
   * Where a watcher listens: the address `variance watch` prints. Defaults to
   * `VARIANCE_AUTHORITY_VANTAGE`, and is read only by an enabled head. A request
   * that carries no way home is reported there as an execution of its own, so
   * an application used by hand says what each request entered. What a request
   * a case drove runs inside `enter` still answers that case, and a watcher
   * hears nothing of it. With a {@link JourneyCollectorOptions.trace}, what a
   * traced flow runs outside every `enter` is listed under its trace id: a
   * flow no `enter` wrapped, and a middleware ahead of `enter` in any request.
   */
  readonly watcher?: string;
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
