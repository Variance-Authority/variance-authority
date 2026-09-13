/**
 * Pixels made by the browser the suite already pinned.
 *
 * The deferred path renders a document somewhere reproducible; this one asks the
 * page under test for its own screenshot, which is the only way to capture a
 * state a document cannot restate — and pays for it by having to declare the
 * launch that produced the pixels, because nothing else here can say which
 * machine, which flags, which scale.
 */

import type { Locator, Page } from '@playwright/test';
import { digestValue, documentDigest } from '@variance-authority/core/format';
import type { AttributedRegion } from '@variance-authority/core/attribute';
import type { Raster, RenderIdentity, SemanticSnapshot } from '@variance-authority/core/format';
import { normalize } from '@variance-authority/core/rules';
import { observeRasters } from '@variance-authority/observe';
import { suspenseRefusal } from '@variance-authority/react';
import { acquireFrom } from './acquire.js';
import { driftBetween, listDrift } from './drift.js';
import type { AcquireRequest } from './page-agent.js';
import type { InPlaceCaptureOptions } from './options.js';

export async function stableRaster(
  page: Page,
  locator: Locator,
  document: Parameters<typeof documentDigest>[0],
  fonts: readonly string[],
  stabilization: RenderIdentity['stabilization'],
  options: InPlaceCaptureOptions,
  snapshot: SemanticSnapshot,
): Promise<Raster> {
  const screenshot = {
    type: 'png',
    // Acquisition leaves the declared CSS holds installed. Let that one owner
    // define both semantic and pixel state; asking Playwright to fast-forward
    // animations or hide the caret here would apply a conflicting second
    // intervention — and the driver's caret switch writes to the DOM, which the
    // confirming acquisition below would read as the subject moving.
    animations: 'allow',
    caret: 'initial',
  } as const;
  const browser = page.context().browser();
  const engine = browser?.browserType().name() ?? 'browser';
  const identity: RenderIdentity = {
    renderer: `playwright-${engine}-existing-page`,
    engine: `${engine}@${browser?.version() ?? 'unknown'}`,
    platform: `${process.platform}/${process.arch}`,
    deviceScaleFactor: document.viewport.deviceScaleFactor,
    fonts,
    ...(stabilization === undefined ? {} : { stabilization }),
    rasterization: digestValue({
      browser: {
        headless: options.browser.headless,
        launchArgs: [...options.browser.launchArgs],
      },
      screenshot,
    }),
  };
  // Asked once, before the first screenshot. A family the host lacks measures
  // as the generic it falls back to, which is the only evidence left that the
  // pixels were painted with a substitute -- and `missingFonts` is what the
  // docket counts and `push` refuses to approve over. The deferred renderer has
  // asked this since it shipped; in-place capture reported an empty list and so
  // reported every host as complete.
  const missingFonts = (await page.evaluate(PROBE_FONTS)) as string[];

  const count = Math.max(2, options.stabilityChecks ?? 2);
  const rasters: Raster[] = [];

  for (let index = 0; index < count; index += 1) {
    const bytes = await locator.screenshot(screenshot);
    const box = await locator.boundingBox();
    if (box === null) throw new Error(`subject ${document.subject.id} has no screenshot box`);
    rasters.push({
      documentDigest: documentDigest(document),
      identity,
      width: Math.round(box.width * document.viewport.deviceScaleFactor),
      height: Math.round(box.height * document.viewport.deviceScaleFactor),
      bytes: bytes.toString('base64'),
      missingFonts,
    });
  }

  const first = rasters[0]!;
  for (const next of rasters.slice(1)) {
    const agreement = await observeRasters(document.subject.id, first, next, { snapshot });
    if (agreement.verdict !== 'unchanged') {
      throw new Error(
        `in-place capture for ${document.subject.id} is unstable: ${agreement.because}` +
          whereUnstable(agreement.regions),
      );
    }
  }
  return first;
}

/**
 * Families the page declared that this host answers with a generic.
 *
 * Source, not a function reference. A test run instruments this module for
 * coverage, and a function handed to `page.evaluate` is serialized *after* that
 * rewrite -- the page then evaluates a body calling counters that exist only in
 * the test process. A string closes over nothing and cannot be rewritten.
 *
 * A family whose stack measures exactly as the bare generic contributed
 * nothing: either it never loaded or the host does not have it, and both
 * produce the same substituted metrics.
 */
const PROBE_FONTS = `(() => {
  const context = document.createElement('canvas').getContext('2d');
  if (context === null) return [];
  const SAMPLE = 'mmmmmmmmmmlliWWWWQ@#0123456789';
  const widthOf = (stack) => {
    context.font = '72px ' + stack;
    return context.measureText(SAMPLE).width;
  };
  const families = [...new Set([...document.fonts].map((face) => face.family))];
  return families.filter((family) =>
    ['monospace', 'sans-serif', 'serif'].every(
      (generic) => widthOf('"' + family + '",' + generic) === widthOf(generic),
    ),
  );
})()`;

/**
 * The nodes two screenshots of one unheld state disagreed about.
 *
 * The comparison already attributed every region; discarding that and saying
 * only that the screenshots disagree leaves the caller to find the animation,
 * caret or timer themselves. Names, deduplicated and capped, because a subject
 * that moves everywhere is described by the first few movers.
 */
function whereUnstable(regions: readonly AttributedRegion[]): string {
  const names: string[] = [];
  for (const region of regions) {
    const at = region.source === undefined ? undefined : `${region.source.file}:${region.source.line}`;
    const name = region.where ?? region.component ?? at;
    if (name !== undefined && !names.includes(name)) names.push(name);
  }
  if (names.length === 0) return '';
  const shown = names.slice(0, 4);
  const rest = names.length - shown.length;
  return ` — moving in ${shown.join(', ')}${rest > 0 ? ` and ${rest} more` : ''}`;
}

/**
 * One held reading of the subject and the raster taken of it.
 *
 * `held` is the acquisition the raster belongs to -- not necessarily the first
 * one, because a subject that was still moving is read again.
 */
export interface SettledCapture {
  readonly held: Awaited<ReturnType<typeof acquireFrom>>;
  readonly snapshot: SemanticSnapshot;
  readonly raster: Raster;
}

/**
 * Photograph a live subject, letting it come to rest first.
 *
 * A subject captured in place is captured while the application is still
 * running, so "the page moved between the two reads that prove it held still"
 * describes the ordinary case as often as the pathological one: a menu that just
 * opened, a snackbar sliding in, a grid that has just been given its rows.
 * Refusing on the first disagreement made every one of those a failed test.
 *
 * So the cycle is retried. The confirming read of a failed attempt is already a
 * fresh acquisition, which is what the next attempt starts from -- a retry costs
 * a screenshot pair and no extra round-trip. A subject that repaints on every
 * screenshot still exhausts the budget and is still refused, and the message
 * says how many attempts bought nothing.
 */
export async function settledCapture(
  where: {
    readonly page: Page;
    readonly locator: Locator;
    readonly request: AcquireRequest;
    readonly materialization: InPlaceCaptureOptions;
  },
  first: { readonly acquired: SettledCapture['held']; readonly snapshot: SemanticSnapshot },
  about: {
    readonly subjectId: string;
    readonly fonts: readonly string[];
    readonly loading: boolean;
  },
): Promise<SettledCapture> {
  const { page, locator, request, materialization } = where;
  let held = first.acquired;
  let heldSnapshot = first.snapshot;
  let restless: string | undefined;
  const attempts = Math.max(1, materialization.settleAttempts ?? 3);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    // Widening pauses rather than an immediate retry. What is being waited out
    // is a transition with a duration, and three reads taken back to back all
    // land inside the same one.
    if (attempt > 0) await page.waitForTimeout(attempt * 100);
    let taken: Raster;
    try {
      taken = await stableRaster(
        page,
        locator,
        held.document,
        about.fonts,
        held.stabilization.digest,
        materialization,
        heldSnapshot,
      );
    } catch (error) {
      restless = error instanceof Error ? error.message : String(error);
      held = await acquireFrom(page, locator, request);
      heldSnapshot = normalize(held.capture);
      continue;
    }

    const confirmed = await acquireFrom(page, locator, request);
    const confirmedUnsettled = suspenseRefusal(confirmed.suspense, {
      subjectId: about.subjectId,
      declaredLoading: about.loading,
    });
    // Not retried: a subtree still showing a fallback is a decision the test has
    // to make, not a state that settles on its own within this budget.
    if (confirmedUnsettled !== undefined) throw new Error(confirmedUnsettled);
    const confirmedSnapshot = normalize(confirmed.capture);
    const drifted = driftBetween(
      {
        document: held.document,
        snapshot: heldSnapshot,
        accessibility: held.accessibility,
        stabilization: held.stabilization,
      },
      {
        document: confirmed.document,
        snapshot: confirmedSnapshot,
        accessibility: confirmed.accessibility,
        stabilization: confirmed.stabilization,
      },
    );
    if (drifted.length === 0) return { held, snapshot: heldSnapshot, raster: taken };

    restless =
      `in-place capture for ${about.subjectId} changed between acquisition and screenshots: ` +
      `${listDrift(drifted)} moved while the page was being photographed`;
    held = confirmed;
    heldSnapshot = confirmedSnapshot;
  }

  throw new Error(
    `${restless ?? `in-place capture for ${about.subjectId} never held still`}` +
      ` (${attempts} attempt${attempts === 1 ? '' : 's'})`,
  );
}
