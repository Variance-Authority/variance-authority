// compass: variance-authority.harness
import type { Page, Request } from '@playwright/test';

/**
 * How an action learns that the app has finished answering it. What an action
 * does with the answer does not depend on how it was come by: another sign of
 * pending work is another `Quiet`.
 */
export interface Quiet {
  /** Resolves once the act is done and the page has been quiet since. Asked for when the act is done. */
  settled(): Promise<'quiet'>;
  /** Whether nothing has begun since the page last went quiet. */
  still(): boolean;
  /** What holds the quiet off, in words, and absent when nothing does. */
  held(): string | undefined;
  stop(): void;
}

/**
 * The kinds of request that are no sign of an answer on its way: a stream the
 * server never ends, and what a page loads to draw itself. A copy of the kinds
 * `@variance-authority/playwright` does not wait for in `arrivals.ts`, held
 * here because this package imports nothing from it; one owner for both is
 * https://github.com/Variance-Authority/variance-authority/issues/1472.
 */
const NOT_AWAITED: ReadonlySet<string> = new Set(['eventsource', 'font', 'image', 'media', 'websocket']);

/**
 * Quiet told from the page's requests, the one sign of pending work every app
 * gives without being asked: no request in flight for `period` ms. Followed
 * from before the act, so none it starts is missed.
 */
export function requests(period: number): (page: Page) => Quiet {
  return (page) => {
    const flying = new Set<Request>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Absent until the act is done: the page is not quiet while the test still acts on it.
    let settle: ((value: 'quiet') => void) | undefined;
    // A deadline, not a look: it is armed when the last request ends and
    // disarmed when another begins, so it fires only on a full quiet period.
    let still = false;
    const arm = (): void => {
      clearTimeout(timer);
      const settled = settle;
      if (settled === undefined || flying.size > 0) return;
      timer = setTimeout(() => {
        still = true;
        settled('quiet');
      }, period);
    };
    const began = (request: Request): void => {
      if (NOT_AWAITED.has(request.resourceType())) return;
      flying.add(request);
      still = false;
      clearTimeout(timer);
    };
    const ended = (request: Request): void => {
      if (flying.delete(request)) arm();
    };
    page.on('request', began);
    page.on('requestfinished', ended);
    page.on('requestfailed', ended);
    return {
      settled: () =>
        new Promise((resolve) => {
          settle = resolve;
          arm();
        }),
      still: () => still,
      held: () =>
        flying.size === 0
          ? undefined
          : `${[...flying].map((request) => `${request.method()} ${new URL(request.url()).pathname}`).join(', ')} still in flight`,
      stop: () => {
        clearTimeout(timer);
        page.off('request', began);
        page.off('requestfinished', ended);
        page.off('requestfailed', ended);
      },
    };
  };
}
