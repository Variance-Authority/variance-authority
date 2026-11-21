// compass: variance-authority.harness

/** The clock both surfaces tell quiet by: work begins, work ends, and a period passes with none pending. */
export interface QuietPeriod {
  /** Work began: the page is not quiet, and the period starts again once it ends. */
  began(): void;
  /** Work ended, or the page changed: the period starts again if nothing else is pending. */
  ended(): void;
  /** Resolves once the act is done and a whole period has passed with nothing pending. */
  settled(): Promise<'quiet'>;
  still(): boolean;
  stop(): void;
}

/** A quiet period over `pending`, the count of work in flight that the caller keeps. */
export function quietPeriod(period: number, pending: () => number): QuietPeriod {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Absent until the act is done: the page is not quiet while the test still acts on it.
  let settle: ((value: 'quiet') => void) | undefined;
  let still = false;
  const ended = (): void => {
    clearTimeout(timer);
    const settled = settle;
    if (settled === undefined || pending() > 0) return;
    // A deadline, not a look: armed when the last work ends and disarmed when
    // more begins, so it fires only on a full quiet period.
    timer = setTimeout(() => {
      still = true;
      settled('quiet');
    }, period);
  };
  return {
    began: () => {
      still = false;
      clearTimeout(timer);
    },
    ended,
    settled: () =>
      new Promise((resolve) => {
        settle = resolve;
        ended();
      }),
    still: () => still,
    stop: () => clearTimeout(timer),
  };
}
