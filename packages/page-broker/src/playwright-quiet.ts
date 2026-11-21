// compass: variance-authority.harness
import type { Page, Request } from 'playwright-core';
import { quietPeriod } from './quiet-period.js';
import type { Quiet } from './surface.js';

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
    const clock = quietPeriod(period, () => flying.size);
    const began = (request: Request): void => {
      if (NOT_AWAITED.has(request.resourceType())) return;
      flying.add(request);
      clock.began();
    };
    const ended = (request: Request): void => {
      if (flying.delete(request)) clock.ended();
    };
    page.on('request', began);
    page.on('requestfinished', ended);
    page.on('requestfailed', ended);
    return {
      settled: clock.settled,
      still: clock.still,
      held: () =>
        flying.size === 0
          ? undefined
          : `${[...flying].map((request) => `${request.method()} ${new URL(request.url()).pathname}`).join(', ')} still in flight`,
      stop: () => {
        clock.stop();
        page.off('request', began);
        page.off('requestfinished', ended);
        page.off('requestfailed', ended);
      },
    };
  };
}
