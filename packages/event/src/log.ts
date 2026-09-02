/**
 * What a run heard, and how a test waits on it.
 *
 * The log is the driver's, not the page's, and it outlives navigation: a document
 * that goes away takes its own listener with it, and a test that waits for
 * something announced before the last navigation is asking a reasonable question.
 *
 * ## Past or future, and this is the whole of it
 *
 * {@link EventLog.happened} resolves against announcements **already heard**
 * before it ever subscribes. Anything else would be a race with a stopwatch in
 * it, in the one package whose reason to exist is that races are not tests —
 * `await events.happened(...)` written one line too late would hang until the
 * timeout while the answer sat in the log.
 */

import type { AnnouncedEvent, EventPhase } from './index.js';

/** One announcement as a listener heard it. */
export interface RecordedEvent extends AnnouncedEvent {
  /** Arrival order in this log, from 0. */
  readonly ordinal: number;
  /**
   * Who announced it: `page`, or the name a head reports under.
   *
   * Order rather than a clock, here and everywhere. Two realms on one machine
   * have two clocks and no shared one, and a duration is the thing this package
   * exists to stop a suite from asserting on.
   */
  readonly realm: string;
}

/**
 * A second reader, for what a wait does not consume.
 *
 * A log exists to settle waits, and a wait takes exactly one announcement and
 * leaves the rest. Everything a run heard is worth something to a process
 * watching the run — which realms answered, in what order, what opened and never
 * closed — and that reader cannot poll `seen` from outside the worker. So it is
 * told, at the moment of recording, and told nothing costs one undefined check.
 *
 * Neither call may throw. A listener that took the run out would be an observer
 * breaking its subject, which is the one thing this side may never do.
 */
export interface EventLogOptions {
  /** Told about each announcement as it is recorded, in the same order. */
  readonly onRecord?: (event: RecordedEvent) => void;
  /** Told about each remark, keyed the same way and last write winning. */
  readonly onRemark?: (about: string, sentence: string) => void;
}

/** How long a wait is willing to be wrong about. */
export interface WaitOptions {
  /** Defaults to 5000, which is Playwright's own assertion timeout. */
  readonly timeoutMs?: number;
}

/** Everything one execution announced, and the waits a test can put on it. */
export interface EventLog {
  /** Everything heard so far, in arrival order. */
  readonly seen: readonly RecordedEvent[];
  /**
   * Processes {@link vaStart} opened and {@link vaEnd} has not closed.
   *
   * A run that ends with something pending has found a real thing — the code
   * began work it never finished — and it is a better failure than a timeout
   * because it names the work.
   */
  readonly pending: readonly RecordedEvent[];
  /** Take one announcement from a realm. Returns it as it was recorded. */
  readonly record: (realm: string, event: AnnouncedEvent) => RecordedEvent;
  /** Whether these coordinates have been announced, asked without waiting. */
  readonly saw: (location: string, subject: string, action: string) => boolean;
  /** Settle when these coordinates are announced, in any phase — past or future. */
  readonly happened: (
    location: string,
    subject: string,
    action: string,
    options?: WaitOptions,
  ) => Promise<RecordedEvent>;
  /** Settle when a process on these coordinates ends — past or future. */
  readonly finished: (
    location: string,
    subject: string,
    action: string,
    options?: WaitOptions,
  ) => Promise<RecordedEvent>;
  /**
   * Add a sentence every failure from this log will carry.
   *
   * For what a listener knows and a wait cannot see. The one that matters is a
   * head announcing without a journey: those announcements are real, they are
   * not this execution's, and a timeout that said only "nothing was announced"
   * would send a person to look for a missing call that is right there.
   *
   * Keyed, and last write wins, because the sentence worth reading is usually a
   * count: told once per announcement it would print the same remark at every
   * number it passed through on the way to the one that is true.
   */
  readonly remark: (about: string, sentence: string) => void;
  /** Fail every outstanding wait, because nothing more is going to arrive. */
  readonly close: (because?: string) => void;
}

interface Waiter {
  /** What this wait was for, in the words its failure will use. */
  readonly wanted: string;
  readonly matches: (event: RecordedEvent) => boolean;
  readonly settle: (event: RecordedEvent) => void;
  readonly fail: (error: Error) => void;
}

/** How many announcements a diagnostic prints before it summarizes the rest. */
const LISTED = 20;

/** Start a log with nothing in it. */
export function createEventLog(options: EventLogOptions = {}): EventLog {
  const seen: RecordedEvent[] = [];
  const waiters = new Set<Waiter>();
  const remarks = new Map<string, string>();
  let closed: string | undefined;

  const deliver = (event: RecordedEvent): void => {
    // Deleting the entry being visited is the one mutation a Set iteration is
    // allowed to see and go on, and it is the only one here.
    for (const waiter of waiters) {
      if (!waiter.matches(event)) continue;
      waiters.delete(waiter);
      waiter.settle(event);
    }
  };

  const wait = (
    matches: (event: RecordedEvent) => boolean,
    wanted: string,
    options: WaitOptions,
  ): Promise<RecordedEvent> => {
    const already = seen.find((event) => matches(event));
    if (already !== undefined) return Promise.resolve(already);
    if (closed !== undefined) return Promise.reject(unheard(wanted, closed, seen, remarks));

    const timeoutMs = options.timeoutMs ?? 5000;
    return new Promise<RecordedEvent>((resolve, reject) => {
      const timer = setTimeout(() => {
        waiters.delete(waiter);
        reject(
          new Error(`${wanted} was never announced within ${timeoutMs}ms\n${heard(seen, remarks)}`),
        );
      }, timeoutMs);
      const waiter: Waiter = {
        wanted,
        matches,
        settle: (event) => {
          clearTimeout(timer);
          resolve(event);
        },
        fail: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      waiters.add(waiter);
    });
  };

  return {
    get seen() {
      return [...seen];
    },

    get pending() {
      const open = new Map<string, RecordedEvent>();
      for (const event of seen) {
        if (event.phase === 'start') open.set(coordinate(event), event);
        else if (event.phase === 'end') open.delete(coordinate(event));
      }
      return [...open.values()];
    },

    record: (realm, event) => {
      // The four coordinates and nothing else. A head's line carries its own
      // bookkeeping — a version, a head name, a journey — and letting that
      // through would make `seen` a different shape depending on which realm
      // spoke, which is a thing an adopter's `toEqual` would discover for us.
      const recorded: RecordedEvent = {
        phase: event.phase,
        location: event.location,
        subject: event.subject,
        action: event.action,
        realm,
        ordinal: seen.length,
      };
      seen.push(recorded);
      deliver(recorded);
      told(() => options.onRecord?.(recorded));
      return recorded;
    },

    saw: (location, subject, action) =>
      seen.some((event) => at(event, location, subject, action)),

    happened: (location, subject, action, options = {}) =>
      wait(
        (event) => at(event, location, subject, action),
        `\`${name(location, subject, action)}\``,
        options,
      ),

    finished: (location, subject, action, options = {}) =>
      wait(
        (event) => event.phase === 'end' && at(event, location, subject, action),
        `the end of \`${name(location, subject, action)}\``,
        options,
      ),

    remark: (about, sentence) => {
      remarks.set(about, sentence);
      told(() => options.onRemark?.(about, sentence));
    },

    close: (because = 'the run ended') => {
      closed = because;
      const outstanding = [...waiters];
      waiters.clear();
      for (const waiter of outstanding) {
        waiter.fail(unheard(waiter.wanted, because, seen, remarks));
      }
    },
  };
}

/** Tell the second reader, and let nothing it does reach the run. */
function told(tell: () => void): void {
  try {
    tell();
  } catch {
    // A watcher is an observer. Its failure is its own.
  }
}

function unheard(
  wanted: string,
  because: string,
  seen: readonly RecordedEvent[],
  remarks: ReadonlyMap<string, string>,
): Error {
  return new Error(`${wanted} will not be announced: ${because}\n${heard(seen, remarks)}`);
}

function at(
  event: AnnouncedEvent,
  location: string,
  subject: string,
  action: string,
): boolean {
  return (
    event.location === location && event.subject === subject && event.action === action
  );
}

function coordinate(event: AnnouncedEvent): string {
  return name(event.location, event.subject, event.action);
}

function name(location: string, subject: string, action: string): string {
  return `${location} / ${subject} / ${action}`;
}

function phaseOf(phase: EventPhase): string {
  return phase === 'once' ? '' : ` (${phase})`;
}

/**
 * What the run did announce, which is the half of the failure worth reading.
 *
 * A wait that times out has two very different causes and they need different
 * sentences. Nothing at all means the listener never got installed or the code
 * never calls this package — a setup fact, and the diagnostic says so rather than
 * letting a person read a timeout as a product defect. Something, but not this,
 * usually means the coordinates drifted, so the announcements on the same subject
 * are lifted out where a mistyped action is visible at a glance.
 */
function heard(
  seen: readonly RecordedEvent[],
  remarks: ReadonlyMap<string, string>,
): string {
  const noted = [...remarks.values()];
  if (seen.length === 0) {
    return [
      'Nothing was announced at all, by any realm. Either no listener is ' +
        'installed for this execution, or the code that decides does not call ' +
        '`vae` yet — a wait cannot tell those apart and neither can a timeout.',
      ...noted,
    ].join('\n');
  }
  const listed = seen.slice(0, LISTED);
  const lines = listed.map(
    (event) => `  ${event.realm}  ${coordinate(event)}${phaseOf(event.phase)}`,
  );
  const rest =
    seen.length > listed.length ? [`  … and ${seen.length - listed.length} more`] : [];
  return [`Announced in this execution, in order:`, ...lines, ...rest, ...noted].join('\n');
}
