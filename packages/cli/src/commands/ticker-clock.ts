/**
 * The clock every ticker reads, and the way it says a duration.
 *
 * Shared by the push ticker and the step ticker, because both answer the same
 * question for somebody waiting, and two clocks that disagree about rounding
 * would be two answers to it.
 */

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

export const REAL: TickerClock = {
  now: () => Date.now(),
  every: (ms, run) => {
    const timer = setInterval(run, ms);
    // Never the reason a command stays alive: if the work is over and something
    // else is holding the process, that is the bug and this must not hide it.
    timer.unref();
    return () => {
      clearInterval(timer);
    };
  },
};

/** A duration as somebody waiting reads it, which is never in milliseconds. */
export function seconds(ms: number): string {
  const whole = Math.round(ms / 1000);
  if (whole < 60) return `${(ms / 1000).toFixed(1)}s`;
  return `${String(Math.floor(whole / 60))}m ${String(whole % 60).padStart(2, '0')}s`;
}

/** Whole seconds, then minutes: for a clock that climbs, where tenths flicker. */
export function wholeSeconds(ms: number): string {
  const whole = Math.round(ms / 1000);
  if (whole < 60) return `${String(whole)}s`;
  return `${String(Math.floor(whole / 60))}m ${String(whole % 60).padStart(2, '0')}s`;
}
