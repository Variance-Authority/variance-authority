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
 * service runs `collectEvents()` and both ends are pointed at one directory. Not
 * pointed there, the page still answers and heads are simply silent, which is the
 * same bargain journeys make.
 */

import type { Fixtures, Page, PlaywrightTestArgs, PlaywrightWorkerArgs } from '@playwright/test';
import type { AnnouncedEvent } from '@variance-authority/event';
import {
  EVENT_DIRECTORY_VARIABLE,
  EVENT_REPORT,
  createEventLog,
  eventCollectorSource,
  watchEventReports,
  type EventLog,
} from '@variance-authority/event/collect';
import { JOURNEY_COOKIE, mintJourney } from '@variance-authority/sense/journey';
import type { ExecutionRecorder } from './execution.js';
import { ownerOf } from './execution.js';

export interface VarianceEventsOptions {
  /**
   * Where heads report announcements. Defaults to
   * `VARIANCE_AUTHORITY_EVENTS`, which is also how the service was told, so one
   * variable in `webServer.env` configures both ends.
   */
  readonly directory?: string;
  /**
   * The origin the journey cookie is scoped to. Defaults to the project's
   * `baseURL`. Same-origin is the filter, so this is also the whole of the
   * decision about which services are ever asked to announce.
   */
  readonly origin?: string;
  /**
   * How often a head's report is read, in milliseconds. Defaults to 25.
   *
   * It is latency on a head's announcements and nothing else — a poll that
   * misses one finds it on the next look — so it trades a few milliseconds per
   * wait against a few file reads per second.
   */
  readonly intervalMs?: number;
}

export interface VarianceEventWorkerFixtures {
  /** How this project listens. The defaults need no configuration. */
  readonly varianceEvents: VarianceEventsOptions;
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
    if (joined !== undefined || origin === undefined || directoryFor(varianceEvents) === undefined) {
      await use(joined);
      return;
    }
    const journey = mintJourney();
    await page.context().addCookies([{ name: JOURNEY_COOKIE, value: journey, url: origin }]);
    await use(journey);
  },

  events: async ({ page, varianceEvents, varianceJourney }, use) => {
    const log = createEventLog();
    await listen(page, log);
    const directory = directoryFor(varianceEvents);
    const watch =
      directory === undefined
        ? undefined
        : watchEventReports(
            directory,
            follow(log, varianceJourney),
            varianceEvents.intervalMs === undefined
              ? {}
              : { intervalMs: varianceEvents.intervalMs },
          );
    await use(log);
    // A last look before the waits are failed, so an announcement that landed
    // while the test was finishing settles rather than being reported missing.
    watch?.poll();
    watch?.close();
    log.close('the test ended');
  },
};

function directoryFor(options: VarianceEventsOptions): string | undefined {
  return options.directory ?? process.env[EVENT_DIRECTORY_VARIABLE];
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

/**
 * Take a head's announcements that belong to this execution, and account for the
 * ones that belong to no execution at all.
 *
 * Under any concurrency a head is serving several tests at once, so an
 * announcement without this journey on it is somebody else's and settling a wait
 * with it would be a pass for the wrong reason. Unattributed announcements are
 * neither: they are counted and said out loud in the failure, because a person
 * reading "nothing was announced" while the service is plainly announcing needs
 * to be told the journey never reached it.
 */
function follow(
  log: EventLog,
  journey: string | undefined,
): (report: AnnouncedEvent & { readonly head: string; readonly journey?: string }) => void {
  const loose = new Map<string, number>();
  return (report) => {
    if (report.journey === undefined) {
      const count = (loose.get(report.head) ?? 0) + 1;
      loose.set(report.head, count);
      log.remark(
        report.head,
        `\`${report.head}\` announced ${count === 1 ? 'once' : `${count} times`} with no journey ` +
          'on it, so nothing could say which execution it belonged to and no wait was settled ' +
          'by it. The journey cookie reaches a head that is same-origin and passes it on.',
      );
      return;
    }
    if (report.journey !== journey) return;
    log.record(report.head, report);
  };
}
