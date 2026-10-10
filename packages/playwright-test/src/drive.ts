import type { Fixtures, Page, PlaywrightTestArgs } from '@playwright/test';
import { driveBeforeLoad, recipeToDrive } from '@variance-authority/core/format';

/**
 * The browser state a test's page loads under, set by the `variance` fixture
 * before the test body runs.
 *
 * A page reads its clock and its motion preference in its first script, so an
 * observation, which comes after the test has navigated, is too late to set
 * either. The fixture is not: it hands the test its `page`, and the test
 * navigates after. The pointer is not set here, because a test moves it; it is
 * taken off the page before each reading instead.
 */
export interface VarianceDriveFixtures {
  /**
   * Stabilization tricks the fixture applies to the test's page before the test
   * body, by id. Defaults to `COLLECT_RECIPE`, which holds `reduced-motion` and
   * `freeze-clock`.
   *
   * Name a list without either to load the page as the browser would: keep
   * `freeze-clock` out when your test sets `page.clock` itself.
   */
  readonly varianceStabilize: readonly string[] | undefined;
  /**
   * The instant `freeze-clock` fixes `Date` at, as an ISO 8601 instant with its
   * zone. Defaults to `2024-06-15T12:00:00.000Z`.
   */
  readonly varianceNow: string | undefined;
  /**
   * The ids {@link driveBeforeTest} set on the test's `page`, as
   * `varianceStabilize` and `varianceNow` asked. The `variance` fixture depends
   * on it, so the page is driven before the test body runs, and every
   * observation records the ids its own list names.
   */
  readonly varianceDriven: readonly string[];
}

export const varianceDriveFixtures: Fixtures<VarianceDriveFixtures, object, PlaywrightTestArgs> = {
  varianceStabilize: [undefined, { option: true }],
  varianceNow: [undefined, { option: true }],
  varianceDriven: async ({ page, varianceStabilize, varianceNow }, use) => {
    await use(await driveBeforeTest(page, { stabilize: varianceStabilize, now: varianceNow }));
  },
};

/**
 * Set the clock and the motion preference on a page before it loads, and
 * answer the ids set.
 *
 * The `variance` fixture calls this on the page it hands a test. Call it
 * yourself, before `page.goto()`, on a page the fixture never handed you, such
 * as one opened from your own `browser.newContext()`. `stabilize` and `now` are
 * `varianceStabilize` and `varianceNow`.
 *
 * Everything but the pointer: {@link driveBeforeLoad} also moves it, which
 * costs a frame, and a test moves it again before any reading would see it.
 */
export async function driveBeforeTest(
  page: Page,
  options: { readonly stabilize?: readonly string[] | undefined; readonly now?: string | undefined } = {},
): Promise<readonly string[]> {
  // FIXME: a test that installs `page.clock` replaces the fixed `Date`, and the
  // reading still records `freeze-clock`, a hold it no longer had. Nothing here
  // sees the install; the documentation asks for `freeze-clock` to be left out.
  const recipe = recipeToDrive({
    ...(options.stabilize === undefined ? {} : { stabilize: options.stabilize }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  return await driveBeforeLoad(
    recipe.filter((intervention) => intervention.driver?.pointer === undefined),
    page,
  );
}
