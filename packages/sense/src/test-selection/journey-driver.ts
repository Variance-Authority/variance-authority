/**
 * The driver's half of a journey: the listener every head reports to, the two
 * cookies one execution rides on, and the wait for requests still being served.
 *
 * A head ([`collectJourneys`](./journey.ts)) runs wherever the application
 * does, so it lives behind a bundle-safe entry point. This half opens a socket
 * and runs in the driver's process only, beside the recorders that call it.
 */

import { JOURNEY_COOKIE, RETURN_COOKIE } from '@variance-authority/wire';
import { listen, type Wire } from '@variance-authority/wire/listen';
import { mintJourney } from './journey.js';
import { journeyReportFrom, unsettledScopes, type JourneyReport } from './stitch.js';

/** How long a driver waits at its end for requests a head is still serving. */
export const SETTLING_MS = 5_000;

/** A cookie in the shape a browser context takes it: scoped to an origin. */
export interface JourneyCookie {
  readonly name: string;
  readonly value: string;
  readonly url: string;
}

/** One execution's journey, and the cookies that carry it to every head. */
export interface MintedJourney {
  readonly journey: string;
  readonly cookies: readonly JourneyCookie[];
}

export interface JourneyDriver {
  /** Every account a head has sent so far, in arrival order. */
  readonly reports: readonly JourneyReport[];
  /**
   * Mint one execution's journey, with its cookies scoped to `origin`.
   *
   * Both cookies at once, because they are one fact: this is the execution, and
   * this is where it answers. Set apart, whichever half a later mint overwrote
   * would leave a head reporting under an id nobody claims. The listener opens
   * on the first mint, so a run that never mints holds no port.
   */
  readonly mint: (origin: string) => Promise<MintedJourney>;
  /**
   * Wait for every request a head said it was still serving, up to `withinMs`.
   *
   * A subject is over when its page is, and a handler's scope is over when what
   * it returned settles: a streamed body or a write behind outlives the
   * response. What is still open at the bound is named by the stitch, which
   * retires the run.
   */
  readonly settled: (withinMs?: number) => Promise<void>;
  /** Close the listener this driver opened; one it was handed stays open. */
  readonly close: () => Promise<void>;
}

/**
 * Drive journeys over `wire`, or over a listener opened on the first mint.
 *
 * A wire that is handed in belongs to its caller, who may be announcing on it
 * too, so closing this driver leaves it open.
 */
export function driveJourneys(wire?: Wire): JourneyDriver {
  const reports: JourneyReport[] = [];
  let owned: Wire | undefined;
  let taking: Wire | undefined;
  let giveUp = (): void => {};

  const take = async (): Promise<Wire> => {
    const open = wire ?? (owned ??= await listen());
    if (taking !== open) {
      taking = open;
      giveUp = open.on('journeys', (journey, body) => {
        if (journey === undefined) return;
        const report = journeyReportFrom(journey, body);
        if (report !== undefined) reports.push(report);
      });
    }
    return open;
  };

  return {
    reports,
    mint: async (origin) => {
      const open = await take();
      const journey = mintJourney();
      return {
        journey,
        cookies: [
          { name: JOURNEY_COOKIE, value: journey, url: origin },
          { name: RETURN_COOKIE, value: open.addressFor(journey), url: origin },
        ],
      };
    },
    settled: async (withinMs = SETTLING_MS) => {
      const deadline = Date.now() + withinMs;
      while (unsettledScopes(reports).size > 0 && Date.now() < deadline) {
        await new Promise((settle) => setTimeout(settle, 10));
      }
    },
    close: async () => {
      // Its reports stop here either way; the socket is closed only if it is ours.
      giveUp();
      await owned?.close();
    },
  };
}
