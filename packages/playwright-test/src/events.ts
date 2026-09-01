/**
 * Waiting for what the application decided, instead of for what it drew.
 *
 * The fixtures here are the driver half of `@variance-authority/event`. The
 * browser half needs no build integration and no configuration: the application
 * already calls `vae`, this installs the sink underneath it, and a test that
 * never asks for `events` pays none of it — a fixture nobody destructures is
 * never set up.
 *
 * A head is the part that is extra, and it is extra in the ordinary way: the
 * service runs `collectEvents()`, and one variable says heads are in play so
 * this side leaves them a return address. Not said, the page still answers and
 * heads are simply silent, which is the same bargain journeys make.
 *
 * One listener per worker and one address per execution. A worker runs its tests
 * one at a time, but a *head* does not: it is serving several workers at once,
 * and the address is what keeps one worker's announcement out of another's log
 * without either of them knowing the other exists.
 */

import type { Fixtures, Page, PlaywrightTestArgs, PlaywrightWorkerArgs } from '@playwright/test';
import type { AnnouncedEvent } from '@variance-authority/event';
import {
  EVENT_COOKIE,
  EVENT_REPORT,
  EVENT_VARIABLE,
  createEventLog,
  eventCollectorSource,
  receiveEvents,
  type EventLog,
  type HeadEventReport,
} from '@variance-authority/event/collect';
import { JOURNEY_COOKIE, mintJourney } from '@variance-authority/sense/journey';
import type { ExecutionRecorder } from './execution.js';
import { ownerOf } from './execution.js';

export interface VarianceEventsOptions {
  /**
   * Whether services announce in this run. Defaults to whether
   * `VARIANCE_AUTHORITY_EVENTS` is set, which is also how a service was told, so
   * one line in `webServer.env` configures both ends.
   *
   * False costs nothing at all: no listener, no cookie, and a page that still
   * answers for itself.
   */
  readonly heads?: boolean;
  /**
   * The origin the cookies are scoped to. Defaults to the project's `baseURL`.
   * Same-origin is the filter, so this is also the whole of the decision about
   * which services are ever asked to announce.
   */
  readonly origin?: string;
}

export interface VarianceEventWorkerFixtures {
  /** How this project listens. The defaults need no configuration. */
  readonly varianceEvents: VarianceEventsOptions;
  /**
   * The worker's listener, and the desk that routes what arrives to whichever
   * test is waiting for it. Undefined when no head is expected.
   */
  readonly varianceEventDesk: EventDesk | undefined;
}

export interface VarianceEventFixtures {
  /**
   * This execution's opaque id, once something needs the heads to name it.
   *
   * Undefined when nothing does: a run with no heads has one realm, and an id
   * that distinguishes executions inside it distinguishes nothing.
   */
  readonly varianceJourney: string | undefined;
  /**
   * What this execution announced, and the waits a test can put on it.
   *
   * ```ts
   * await events.happened('checkout', 'upsell-modal', 'decided');
   * await expect(page.getByRole('dialog')).toBeHidden();
   * ```
   */
  readonly events: EventLog;
}

/** Where a head answers, and who is listening for it right now. */
export interface EventDesk {
  readonly endpointFor: (journey: string) => string;
  /** Take this execution's announcements until the returned call gives it up. */
  readonly open: (journey: string, log: EventLog) => () => void;
  readonly close: () => Promise<void>;
}

interface RecorderFixture {
  readonly varianceRecorder: ExecutionRecorder | undefined;
}

/**
 * Merged into `varianceFixtures` rather than used on its own: `varianceJourney`
 * reads the recorder, so this half is a part of that bundle and not a bundle.
 */
export const varianceEventFixtures: Fixtures<
  VarianceEventFixtures,
  VarianceEventWorkerFixtures & RecorderFixture,
  PlaywrightTestArgs,
  PlaywrightWorkerArgs
> = {
  varianceEvents: [{}, { scope: 'worker', option: true }],

  varianceEventDesk: [
    async ({ varianceEvents }, use) => {
      if (!expectsHeads(varianceEvents)) {
        await use(undefined);
        return;
      }
      const desk = await openDesk();
      await use(desk);
      await desk.close();
    },
    { scope: 'worker' },
  ],

  // One minting site for the whole bundle, which is the only reason this is a
  // fixture rather than two lines in each of the two places that want it. Two
  // minters means two cookies under one name, so whichever wrote last decides
  // what the heads report under and the other half quietly attributes nothing.
  varianceJourney: async ({ page, varianceEvents, varianceRecorder }, use, testInfo) => {
    const origin = varianceEvents.origin ?? testInfo.project.use.baseURL;
    const joined =
      varianceRecorder === undefined
        ? undefined
        : await varianceRecorder.join(page, ownerOf(process.cwd(), testInfo), origin);
    if (joined !== undefined || origin === undefined || !expectsHeads(varianceEvents)) {
      await use(joined);
      return;
    }
    const journey = mintJourney();
    await page.context().addCookies([{ name: JOURNEY_COOKIE, value: journey, url: origin }]);
    await use(journey);
  },

  events: async ({ page, varianceEvents, varianceJourney, varianceEventDesk }, use, testInfo) => {
    const log = createEventLog();
    await listen(page, log);

    const origin = varianceEvents.origin ?? testInfo.project.use.baseURL;
    const give =
      varianceEventDesk === undefined || varianceJourney === undefined || origin === undefined
        ? undefined
        : await address(page, varianceEventDesk, varianceJourney, origin, log);

    await use(log);
    give?.();
    log.close('the test ended');
  },
};

function expectsHeads(options: VarianceEventsOptions): boolean {
  return options.heads ?? process.env[EVENT_VARIABLE] !== undefined;
}

/** Leave this execution's return address where every same-origin head will find it. */
async function address(
  page: Page,
  desk: EventDesk,
  journey: string,
  origin: string,
  log: EventLog,
): Promise<() => void> {
  const give = desk.open(journey, log);
  await page
    .context()
    .addCookies([{ name: EVENT_COOKIE, value: desk.endpointFor(journey), url: origin }]);
  return give;
}

/**
 * The worker's listener, with a desk in front of it.
 *
 * A report names its execution by the address it arrived on, so routing is a
 * lookup and nothing else. What arrives for an execution nobody has open is
 * **not** given to whoever is here now — that is the pass for the wrong reason
 * this whole mechanism exists to refuse — but it is not silently dropped either:
 * it is remarked on, because a head that is plainly talking while a test hears
 * nothing is a wire problem, and the person reading the failure needs to be told
 * which half was alive.
 */
async function openDesk(): Promise<EventDesk> {
  const logs = new Map<string, EventLog>();
  const unclaimed = new Map<string, number>();

  const receiver = await receiveEvents((journey, report) => {
    const log = logs.get(journey);
    if (log !== undefined) {
      log.record(report.head, report);
      return;
    }
    const count = (unclaimed.get(report.head) ?? 0) + 1;
    unclaimed.set(report.head, count);
    for (const open of logs.values()) open.remark(report.head, stray(report, count));
  });

  return {
    endpointFor: receiver.endpointFor,
    open: (journey, log) => {
      logs.set(journey, log);
      return () => logs.delete(journey);
    },
    close: receiver.close,
  };
}

function stray(report: HeadEventReport, count: number): string {
  return (
    `\`${report.head}\` answered ${count === 1 ? 'once' : `${count} times`} for an execution no ` +
    'test here owns, so nothing it said settled a wait. A head that is handed one execution’s ' +
    'cookie while serving another announces to whoever left the address, which is what a hop ' +
    'that forwards a stale `Cookie` header looks like from this side.'
  );
}

/** Put the sink in the page and take what it says. */
async function listen(page: Page, log: EventLog): Promise<void> {
  await page.exposeFunction(EVENT_REPORT, (event: AnnouncedEvent) => {
    log.record('page', event);
  });
  // After the channel rather than before, and it would work either way: the
  // page's sink holds what it cannot yet report. The order here is the cheaper
  // one, not the correct one.
  await page.addInitScript(eventCollectorSource());
}
