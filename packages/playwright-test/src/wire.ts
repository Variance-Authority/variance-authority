/**
 * The worker's end of the medium every instrument under test reports on.
 *
 * One per worker, and one address per execution. A worker runs its tests one at
 * a time, but the *services* it drives do not: they answer several workers at
 * once, and the address is what keeps one worker's traffic out of another's
 * without either of them knowing the other exists.
 *
 * It is one object rather than one per instrument because the realms are what
 * differ, not the instruments. A page reports through a function this worker
 * exposed; a service in another process reports through a socket; a server the
 * suite started inside itself reports through neither. Announcements
 * (`@variance-authority/event`) and coverage accounts
 * (`@variance-authority/sense/journey`) travel all three the same way, under the
 * same execution id, and the routing above here reads only which instrument was
 * speaking.
 */

import type { Fixtures, PlaywrightTestArgs, PlaywrightWorkerArgs } from '@playwright/test';
import { listen, type Wire } from '@variance-authority/wire/listen';

export interface VarianceWireFixtures {
  /**
   * Where this worker is reachable, for whatever it is driving.
   *
   * Loopback and an ephemeral port, so nothing is agreed in advance and workers
   * need no word between them. It holds nothing open at exit: a run that has
   * finished leaves whether or not a service is still talking.
   */
  readonly varianceWire: Wire;
}

export const varianceWireFixtures: Fixtures<
  Record<never, never>,
  VarianceWireFixtures,
  PlaywrightTestArgs,
  PlaywrightWorkerArgs
> = {
  varianceWire: [
    // Playwright reads this parameter's destructured names to discover a
    // fixture's dependencies, and rejects a parameter it cannot destructure. An
    // empty pattern is how "depends on nothing" is spelled.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const wire = await listen();
      await use(wire);
      await wire.close();
    },
    { scope: 'worker' },
  ],
};
