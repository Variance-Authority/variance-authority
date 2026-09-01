/**
 * `@variance-authority/event` — what the code decided, said out loud.
 *
 * A test asserting on a screen can only ever ask *is it there now*. That is the
 * wrong question and it is the origin of most of what a suite calls flake. A
 * modal that appears in 40 ms passes; the same modal behind a slow feature-flag
 * read fails, and the failure is a timing report dressed as a product defect.
 * The usual answers make it worse. A `waitFor` guesses a duration, so it is
 * either too short on a loaded machine or paid on every run. A retry loop turns
 * a race into a slower race.
 *
 * ## The one it cannot ask at all
 *
 * **A negative has no timing.** *The modal does not appear* is indistinguishable
 * from *the modal has not appeared yet*, and no amount of waiting separates them:
 * waiting longer makes the assertion slower and never makes it true. So a suite
 * either sleeps an arbitrary number and hopes, or stops testing the branch where
 * nothing happens — which is usually the branch that matters, because it is the
 * one a person only notices when it breaks.
 *
 * There is no observation of the screen that closes this. The screen is the same
 * either way. What is missing is not evidence, it is an **announcement**: the
 * code knows it decided, and nothing carries that outward.
 *
 * ```ts
 * import { vae } from '@variance-authority/event';
 *
 * const show = await shouldUpsell(cart);
 * vae('checkout', 'upsell-modal', 'decided');
 * if (show) setUpsell(true);
 * ```
 *
 * The test waits for `decided` and then asks its question. Both branches are now
 * assertable, on the first run, with no duration anywhere:
 *
 * ```ts
 * await events.happened('checkout', 'upsell-modal', 'decided');
 * await expect(page.getByRole('dialog')).toBeHidden();
 * ```
 *
 * ## Three coordinates, and nothing else
 *
 * `location`, `subject`, `action` — the same triple the test names back. Not a
 * message, because prose drifts on one side of the wire and not the other; not a
 * payload, because a payload invites assertions on data the DOM already carries,
 * and this exists to say **when**, never **what**. The what is asserted the
 * ordinary way, one line later, once the when is settled.
 *
 * ## What it costs where nobody is listening
 *
 * One property read and a return. {@link vae} looks for a sink on `globalThis`
 * and finds nothing in production, so the call that ships is an `if` — which is
 * the whole reason these live in product source rather than in a wrapper a test
 * build swaps in. An announcement that is only present under test announces the
 * test harness, not the decision.
 *
 * Nothing a listener does can reach the code it listens to: a sink that throws is
 * swallowed here. An observer that can break the subject is not an observer.
 */

/** Where a listener installs itself, and the only name this package puts on `globalThis`. */
export const EVENT_SINK = '__VAE__';

/**
 * Whether an announcement stands alone or bounds something that takes time.
 *
 * `once` is a moment: it happened. `start` and `end` are the two ends of a
 * process, and they are a pair rather than two moments because *started and never
 * ended* is a fact a run can report and *no end arrived* on its own is not.
 */
export type EventPhase = 'once' | 'start' | 'end';

/** One announcement, in the words the code used. */
export interface AnnouncedEvent {
  readonly phase: EventPhase;
  /** The part of the system that spoke: a screen, a boundary, a handler. */
  readonly location: string;
  /** What the announcement is about. */
  readonly subject: string;
  /** What happened to it. */
  readonly action: string;
}

type Sink = (phase: EventPhase, location: string, subject: string, action: string) => void;

// Named separately from `EVENT_SINK` because a type cannot be keyed by a value;
// `announces its own sink name` in the tests is what keeps the two the same.
const scope = globalThis as typeof globalThis & { __VAE__?: Sink };

function announce(
  phase: EventPhase,
  location: string,
  subject: string,
  action: string,
): void {
  const sink = scope.__VAE__;
  if (typeof sink !== 'function') return;
  try {
    sink(phase, location, subject, action);
  } catch {
    // Deliberately silent, and this is the load-bearing line of the package. A
    // listener is a test harness in another process; a bug in one may not become
    // a bug in the application that shipped the announcement. The failure a
    // swallowed throw produces is a wait that times out, which names what it
    // waited for and what it did hear — a diagnostic, in the right process.
  }
}

/**
 * Announce that something happened, at the moment the code knows it did.
 *
 * The call belongs where the **decision** is made, not where its consequence
 * renders. Announced from the render, it says the same thing the screen already
 * said and is worth nothing; announced from the decision, it is the only evidence
 * that the branch which does nothing was taken.
 */
export function vae(location: string, subject: string, action: string): void {
  announce('once', location, subject, action);
}

/**
 * Announce that something that takes time has begun.
 *
 * Pair it with {@link vaEnd} on the same three coordinates. A test waits for the
 * end; a run that finishes with a start unanswered can say so, which is a
 * different and more useful failure than a timeout.
 */
export function vaStart(location: string, subject: string, action: string): void {
  announce('start', location, subject, action);
}

/** Announce that the process {@link vaStart} opened on these coordinates is over. */
export function vaEnd(location: string, subject: string, action: string): void {
  announce('end', location, subject, action);
}
