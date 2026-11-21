// compass: variance-authority.harness
import { awaitedRequest } from '@variance-authority/core';
import type { Page, Request } from 'playwright-core';
import { quietPeriod } from './quiet-period.js';
import type { Quiet } from './surface.js';

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
      if (!awaitedRequest(request)) return;
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
