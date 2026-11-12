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
 * The listener is the worker's, not this file's: announcements and coverage
 * accounts are two things said about the same execution, so they arrive on one
 * medium ([`wire.ts`](./wire.ts)) under one id, and this end reads only which of
 * the two was speaking. A page reports through a function this worker exposed
 * and a head reports through a socket; nothing below routes on which.
 */

import type { Fixtures, Page, PlaywrightTestArgs, PlaywrightWorkerArgs } from '@playwright/test';
import type { AnnouncedEvent } from '@variance-authority/event';
import {
  EVENT_VARIABLE,
  createEventLog,
  eventCollectorSource,
  type EventLog,
  type HeadEventReport,
} from '@variance-authority/event/collect';
import { mintJourney } from '@variance-authority/sense/journey';
import { JOURNEY_COOKIE, RETURN_COOKIE } from '@variance-authority/wire';
import { WIRE_REPORT, wireCarrierSource, type Wire } from '@variance-authority/wire/listen';
import type { RecorderFixture } from './completed.js';
import { testOf } from './execution.js';
import type { VarianceVantageWorkerFixtures } from './vantage.js';
import type { VarianceWireFixtures } from './wire.js';

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
  /** The desk that routes what arrives to whichever test is waiting for it. */
  readonly varianceEventDesk: EventDesk;
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

/** Where an announcement answers, and who is listening for it right now. */
export interface EventDesk {
  /** Where a head serving this execution should report. */
  readonly addressFor: (journey: string) => string;
  /** Take this execution's announcements until the returned call gives it up. */
  readonly open: (journey: string, log: EventLog) => () => void;
  /** Route one announcement, for a realm the driver is inside rather than beside. */
  readonly take: (journey: string, report: HeadEventReport) => void;
}

/**
 * Merged into `varianceFixtures` rather than used on its own: `varianceJourney`
 * reads the recorder, so this half is a part of that bundle and not a bundle.
 */
export const varianceEventFixtures: Fixtures<
  VarianceEventFixtures,
  VarianceEventWorkerFixtures &
    RecorderFixture &
    VarianceWireFixtures &
    VarianceVantageWorkerFixtures,
  PlaywrightTestArgs,
  PlaywrightWorkerArgs
> = {
  varianceEvents: [{}, { scope: 'worker', option: true }],

  varianceEventDesk: [
    async ({ varianceWire }, use) => {
      const desk = openDesk(varianceWire);
      await use(desk);
    },
    { scope: 'worker' },
  ],

  // One minting site for the whole bundle, which is the only reason this is a
  // fixture rather than two lines in each of the two places that want it. Two
  // minters means two cookies under one name, so whichever wrote last decides
  // what the heads report under and the other half quietly attributes nothing.
  varianceJourney: async (
    { page, varianceEvents, varianceEventDesk, varianceRecorder },
    use,
    testInfo,
  ) => {
    const origin = varianceEvents.origin ?? testInfo.project.use.baseURL;
    const joined =
      varianceRecorder === undefined
        ? undefined
        : await varianceRecorder.join(page, varianceRecorder.owner(testInfo), origin, testOf(testInfo));
    if (joined !== undefined || origin === undefined || !expectsHeads(varianceEvents)) {
      await use(joined);
      return;
    }
    const journey = mintJourney();
    await page.context().addCookies([
      { name: JOURNEY_COOKIE, value: journey, url: origin },
      { name: RETURN_COOKIE, value: varianceEventDesk.addressFor(journey), url: origin },
    ]);
    await use(journey);
  },

  events: async ({ page, varianceJourney, varianceEventDesk, varianceVantage }, use, testInfo) => {
    // A watcher is told at the moment of recording rather than at teardown: the
    // question worth asking of a running suite is what the test hanging right
    // now has heard, and an answer that arrives when it finishes is an answer to
    // a different question.
    const log = createEventLog(
      varianceVantage === undefined
        ? {}
        : {
            onRecord: (event) => varianceVantage.heard(testInfo.testId, event),
            onRemark: (about, sentence) =>
              varianceVantage.remarked(testInfo.testId, about, sentence),
          },
    );
    // A page with no execution of its own still has one here. A worker runs its
    // tests one at a time, so a key nothing else can mint is enough to route by,
    // and the page and a head reach the same desk by the same rule.
    const here = varianceJourney ?? `\u0000${testInfo.testId}`;
    const give = varianceEventDesk.open(here, log);
    await listen(page, varianceEventDesk, here);

    await use(log);
    give();
    log.close('the test ended');
  },
};

function expectsHeads(options: VarianceEventsOptions): boolean {
  return options.heads ?? process.env[EVENT_VARIABLE] !== undefined;
}

/**
 * A desk in front of the worker's listener.
 *
 * An announcement names its execution by the address it arrived on, so routing
 * is a lookup and nothing else. What arrives for an execution nobody has open is
 * **not** given to whoever is here now — that is the pass for the wrong reason
 * this whole mechanism exists to refuse — but it is not silently dropped either:
 * it is remarked on, because a head that is plainly talking while a test hears
 * nothing is a wire problem, and the person reading the failure needs to be told
 * which half was alive.
 */
function openDesk(wire: Wire): EventDesk {
  const logs = new Map<string, EventLog>();
  const unclaimed = new Map<string, number>();

  const take = (journey: string, report: HeadEventReport): void => {
    const log = logs.get(journey);
    if (log !== undefined) {
      log.record(report.head, report);
      return;
    }
    const count = (unclaimed.get(report.head) ?? 0) + 1;
    unclaimed.set(report.head, count);
    for (const open of logs.values()) open.remark(report.head, stray(report, count));
  };

  wire.on('events', (journey, body) => {
    if (journey === undefined) return;
    const report = body as HeadEventReport;
    if (report.version === 1) take(journey, report);
  });

  return {
    addressFor: wire.addressFor,
    open: (journey, log) => {
      logs.set(journey, log);
      return () => logs.delete(journey);
    },
    take,
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

/**
 * Put the sink in the page and take what it says.
 *
 * The page reaches the same desk a head reaches, by the same rule — it simply
 * gets there through a function this worker exposed instead of through a socket.
 * A document that has no execution cookie yet says so, and `here` is what the
 * report is filed under: the test that is running is the one that installed it.
 */
async function listen(page: Page, desk: EventDesk, here: string): Promise<void> {
  await page.exposeFunction(WIRE_REPORT, (said: Reported) => {
    if (said.participant !== 'events') return;
    const report = said.body as AnnouncedEvent;
    desk.take(said.journey ?? here, { version: 1, head: 'page', ...report });
  });
  // After the channel rather than before, and it would work either way: both
  // sinks hold what they cannot yet report. The order here is the cheaper one,
  // not the correct one.
  await page.addInitScript(wireCarrierSource());
  await page.addInitScript(eventCollectorSource());
}

/** One report, as the page's carrier hands it over. */
interface Reported {
  readonly journey?: string;
  readonly participant: string;
  readonly body: unknown;
}
