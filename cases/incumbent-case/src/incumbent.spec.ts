import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import { SCENARIOS, type Variant } from './scenarios.js';

/**
 * The incumbent arm, run by the incumbent.
 *
 * This file is driven by `playwright test`, not by Vitest, and it does exactly
 * what a team's visual suite does: navigate, and assert a screenshot. There is no
 * reimplementation of `toHaveScreenshot` anywhere in this case — the comparator,
 * the thresholds, the size-mismatch behaviour, the missing-baseline behaviour and
 * the wording of every failure are Playwright's own, produced by Playwright's own
 * process.
 *
 * That is the whole reason the case exists in this shape. A head-to-head against
 * our model of a competitor measures our model. `cases/storybook-case` makes the
 * same argument about reading an index Storybook wrote, and it is the same
 * argument: the only arrangement in which we can be *wrong* is the one where the
 * other side is real.
 *
 * Run in two phases, which is also what a team does — record on the trunk,
 * compare on the branch:
 *
 *   CASE_VARIANT=before playwright test --update-snapshots
 *   CASE_VARIANT=after  playwright test
 *
 * `scripts/incumbent.mjs` runs both and keeps the artifacts.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = pathToFileURL(resolve(HERE, '..', 'page', 'case.html')).href;

const VARIANT: Variant = process.env['CASE_VARIANT'] === 'after' ? 'after' : 'before';

for (const scenario of SCENARIOS) {
  test(scenario.id, async ({ page }) => {
    // The new-subject scenario is defined by having no baseline, so the record
    // phase must not write one. Skipping is the mechanism; the absence is the
    // measurement.
    test.skip(
      VARIANT === 'before' && scenario.baseline === 'none',
      'no baseline is recorded for this scenario — the absence is the scenario',
    );

    await page.goto(`${PAGE}?scenario=${scenario.id}&variant=${VARIANT}`);

    // The mount is synchronous, but the flag is what says so. Screenshotting on
    // `load` alone would race the first commit and produce an empty clip, which
    // reads as a large honest diff and is neither.
    await page.waitForSelector('html[data-case-ready="1"]');

    await expect(page.locator('#subject')).toHaveScreenshot(`${scenario.id}.png`);
  });
}
