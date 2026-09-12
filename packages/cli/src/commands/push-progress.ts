import { CLI_VERSION } from '../version.js';
import type { PushProgress, PushResult } from './push.js';

/**
 * The two ways a push is read while it happens and after it is over.
 *
 * Apart from [`push.ts`](./push.ts) because nothing here is the push. The lines
 * below are what a terminal and a log file each get told, and they change when
 * somebody watching decides they were not told enough — which is a different
 * reason, and a different afternoon, than the body shape changing.
 */

/**
 * The progress, as a terminal shows it and as a log records it.
 *
 * Two shapes for two readers, chosen by whether anyone is watching. A terminal
 * gets one line rewritten in place, because a count that climbs is the whole
 * signal and twenty-one lines of it is a wall. A log file gets one line per
 * phase and nothing per subject: a CI log is read after the fact, where the
 * question is never "how far had it got" but "did it get past the encode".
 *
 * On stderr in both cases. The report on stdout is what a pipeline parses, and a
 * tick that landed in the middle of it would be a progress bar in somebody's
 * JSON.
 *
 * ## Every line carries the clock, and `sending` carries it without being asked
 *
 * The phases are not equally talkative. `encoding` produces an event per subject
 * and can be drawn each time one arrives; `sending` is one POST of the whole
 * body and produces nothing at all until it returns. A line drawn once at the
 * start of it and then left alone is the same silence as before with a sentence
 * in front of it — the operator still cannot tell a slow upload from a dead
 * address, which is the only question they have while they wait.
 *
 * So the elapsed second is on every line, and while `sending` is the phase a
 * timer redraws it. A number that climbs is the whole of the answer: it says
 * the process is alive and it says how long this is taking, and those are what
 * an operator decides on. The timer is `unref`ed, so it can never be the reason
 * a command does not exit, and stops the moment anything else happens.
 */
export function pushTicker(
  write: (text: string) => void,
  tty: boolean,
  clock: TickerClock = REAL,
): { readonly on: (event: PushProgress) => void; readonly done: () => void } {
  let width = 0;
  let stop: (() => void) | undefined;
  const started = clock.now();

  /** Whole seconds, then minutes: a push measured in tenths is not being waited on. */
  const since = (): string => {
    const seconds = Math.round((clock.now() - started) / 1000);
    if (seconds < 60) return `${String(seconds)}s`;
    return `${String(Math.floor(seconds / 60))}m ${String(seconds % 60).padStart(2, '0')}s`;
  };

  const halt = (): void => {
    stop?.();
    stop = undefined;
  };

  const line = (text: string): void => {
    // Padded to the widest line printed so far, or the tail of the longer
    // previous line survives the carriage return and the count reads wrong.
    write(`\r${text.padEnd(width)}`);
    width = Math.max(width, text.length);
  };

  return {
    on: (event) => {
      halt();
      if (event.phase === 'service') {
        // Nothing when the two ends agree. The version that matters is on the
        // report either way, and a tick that says "everything is normal" is a
        // tick people learn to look past.
        if (event.note === undefined) return;
        const said = `  ${event.note}`;
        if (tty) {
          // Left on the screen rather than rewritten by the next phase: it is
          // the one line here that is worth reading after the push is over.
          write(`${said}\n`);
          width = 0;
        } else write(`${said}\n`);
        return;
      }
      if (event.phase === 'asking') {
        // One line, and it is the line that explains the pause. Between the last
        // subject read and the first byte sent there is a round trip nothing
        // else accounts for, and an operator watching a push sit still after
        // "encoding 300/300" should be able to see what it is sitting on.
        const asked = `  asking about ${event.digests} image(s) — ${since()}`;
        if (tty) line(asked);
        else write(`${asked}\n`);
        return;
      }
      if (event.phase === 'sending') {
        const size = `${Math.round(event.bytes / 1024)} KiB`;
        if (!tty) {
          // A log gets the size and no heartbeat. It is read after the fact,
          // where a line per second is a wall and the duration is on the report.
          write(`  sending ${size} in one request\n`);
          return;
        }
        const draw = (): void => {
          line(`  sending ${size} — ${since()}`);
        };
        draw();
        stop = clock.every(1000, draw);
        return;
      }
      if (event.done === 0) {
        if (!tty) write(`  encoding ${event.total} subject(s) of images\n`);
        else if (event.total > 0) line(`  encoding 0/${event.total}`);
        return;
      }
      if (tty) {
        line(
          `  encoding ${event.done}/${event.total} — ` +
            `${Math.round(event.bytes / 1024)} KiB — ${since()}`,
        );
      }
    },
    // Only a terminal has a line to take back. Called whatever the push did,
    // including when it threw: an error printed onto a half-written tick is the
    // one message here that must arrive whole, and a timer still redrawing
    // underneath it would write over the error itself.
    done: () => {
      halt();
      if (tty && width > 0) write(`\r${''.padEnd(width)}\r`);
    },
  };
}

/**
 * The clock and the timer, injected so a test can assert a heartbeat.
 *
 * A test that waited a real second for a real interval would be a test that
 * sometimes waits two.
 */
export interface TickerClock {
  readonly now: () => number;
  /** Returns the call that stops it. */
  readonly every: (ms: number, run: () => void) => () => void;
}

const REAL: TickerClock = {
  now: () => Date.now(),
  every: (ms, run) => {
    const timer = setInterval(run, ms);
    // Never the reason a command stays alive: if the push is over and something
    // else is holding the process, that is the bug and this must not hide it.
    timer.unref();
    return () => {
      clearInterval(timer);
    };
  },
};

/** A duration as somebody waiting reads it, which is never in milliseconds. */
function seconds(ms: number): string {
  const whole = Math.round(ms / 1000);
  if (whole < 60) return `${(ms / 1000).toFixed(1)}s`;
  return `${String(Math.floor(whole / 60))}m ${String(whole % 60).padStart(2, '0')}s`;
}

/** What went up, as the operator reads it. */
export function formatPush(result: PushResult): string {
  const service = result.service.known
    ? `API ${String(result.service.api)}`
    : 'an API version it did not state';
  const lines = [
    `pushed build ${result.build} to ${result.endpoint} in ${seconds(result.elapsedMs)}`,
    // Both halves named on the line somebody keeps. Every slow, fat or
    // unsettling push this command has ever produced was one of these two being
    // older than the other, and until it was printed nobody could see it.
    `  variance ${CLI_VERSION} to a deployment serving ${service}`,
    `  ${result.subjects} subject(s), ` +
      `${result.images.after} candidate(s), ${result.images.before} baseline(s) — ` +
      `${Math.round(result.bytes / 1024)} KiB`,
    // Stated whenever anything was reused, because the alternative reading of a
    // small body is that images went missing.
    ...(result.reused > 0
      ? [`  ${result.reused} image(s) were already there and went as digests`]
      : []),
    // Named one by one rather than counted. A withheld candidate is a subject a
    // reviewer can look at and cannot decide, and discovering that on the page —
    // where the only symptom is a missing button — is discovering it too late.
    ...result.withheld.map(
      (entry) => `  [withheld] ${entry.subject} ${entry.kind}: ${entry.because}`,
    ),
  ];
  return lines.join('\n');
}
