import { test as base, type Locator, type TestInfo } from '@playwright/test';
import { documentDigest, hashComponents, normalize } from '@variance-authority/core';
import type {
  SemanticSnapshot,
  SourceIndex,
  SubjectRef,
  Viewport,
} from '@variance-authority/core';
import { observeAgainstBaseline, type Observation } from '@variance-authority/observe';
import { createPlaywrightRenderer } from '@variance-authority/playwright';
import { settle, type BaselineKey, type RasterStore, type Renderer } from '@variance-authority/raster';
import { suspenseRefusal } from '@variance-authority/react';
import { createDurableStore } from '@variance-authority/store';
import { bundlePageAgent } from './bundle.js';
import { AGENT, type Acquired, type AcquireRequest, type InstalledAgent } from './page-agent.js';

/**
 * The Playwright surface: one fixture, and the matcher next door.
 *
 * What makes this cheaper than the CLI's collector is that **the adopter's test
 * body already is the collector.** `variance run` needs one because it has to
 * mount a project's components and cannot know how; a Playwright test has
 * navigated, mounted and waited before this fixture is reached. What is left is
 * the half this project does own — acquire, render, compare, attribute.
 *
 * Two decisions here are load-bearing rather than plumbing.
 *
 * **The subject is a `Locator`, never a `Page`.** A subject is a subtree, and
 * pruning is what makes the comparison affordable and the report assignable
 * (ADR-0003: 1007 rules parsed, 1 reached the normalizer). Handed a page, pruning
 * has nothing bounded to prune against and every rule the application loaded is
 * in the comparison.
 *
 * **The renderer paints the acquired document; `locator.screenshot()` is not
 * used.** The browser is right there and screenshotting it is one line, which is
 * exactly why the turn is marked. A live-page screenshot has no
 * {@link Renderer.identityFor} behind it — nothing painted it that can say which
 * machine, which scale, which font stack — and deriving a store key caller-side
 * is the drift that interface exists to prevent. The cost is that the subject is
 * painted twice, once by the application and once from its document; what is
 * bought is a baseline any machine can reproduce from the document, including one
 * two networks away.
 */

export interface VarianceOptions {
  /**
   * What the baseline is keyed on. Defaults to the test's title path.
   *
   * A default derived from titles means renaming a test orphans its baseline,
   * which is the right failure — `new` rather than a silent comparison against
   * something else — and is still worth overriding for anything long-lived.
   */
  readonly subjectId?: string;

  /** Defaults to `route`, which is what a navigated page is. */
  readonly subjectKind?: SubjectRef['kind'];

  /**
   * Fonts this machine is asserted to have, as `family/weight/style/hash`.
   *
   * Omitted here it stays omitted: the collector says so in a diagnostic rather
   * than putting a confident value in the environment key. Supplying it is what
   * makes a baseline written on a machine with a different font stack report
   * `incomparable` instead of being compared.
   */
  readonly fonts?: readonly string[];

  /** Component to file. Without it the docket names components and no lines. */
  readonly source?: SourceIndex;

  /** Milliseconds to wait for the subject's Suspense boundaries. Defaults to 5000. */
  readonly suspenseTimeoutMs?: number;

  /**
   * This subject's *loading* state is what is being captured.
   *
   * The escape hatch. Without it, a subtree still showing a Suspense fallback
   * **throws** rather than being recorded: a baseline over a skeleton that was
   * never meant to be one turns every faster machine into a regression, and a
   * failed assertion here is the only thing that reaches the person who can
   * decide which of the two states this test is about.
   */
  readonly loading?: boolean;
}

export interface VarianceFixtures {
  /** Observe one subtree against its stored baseline. */
  readonly variance: (locator: Locator, options?: VarianceOptions) => Promise<Observation>;
}

export interface VarianceWorkerFixtures {
  readonly varianceBundle: string;
  readonly varianceRenderer: Renderer;
  readonly varianceStore: RasterStore;
  readonly varianceBaselines: string;
}

/**
 * Where a run is allowed to promote what it just painted.
 *
 * Playwright's own flag, read rather than reinvented, because a team that types
 * `--update-snapshots` for every other matcher will type it for this one. What it
 * cannot mean here is what it means elsewhere: acceptance promotes an image the
 * run **already produced** and never produces one (ADR-0021), so a candidate that
 * is not in the render cache is refused by name instead of being re-rendered into
 * existence.
 */
function accepting(testInfo: TestInfo): boolean {
  const flag = testInfo.config.updateSnapshots;
  return flag === 'all' || flag === 'changed' || flag === 'missing';
}

function viewportOf(
  size: { width: number; height: number } | null,
  testInfo: TestInfo,
): Viewport {
  if (size === null) {
    throw new Error(
      'variance needs a viewport and this page has none; ' +
        'a null viewport means the image has no declared size, so no two runs are comparable',
    );
  }

  const scheme = testInfo.project.use.colorScheme;
  return {
    ...size,
    deviceScaleFactor: testInfo.project.use.deviceScaleFactor ?? 1,
    colorScheme: scheme === 'dark' ? 'dark' : 'light',
  };
}

export const test = base.extend<VarianceFixtures, VarianceWorkerFixtures>({
  varianceBaselines: ['.variance/baselines', { scope: 'worker', option: true }],

  varianceBundle: [
    // Playwright reads this parameter's destructured names to discover a
    // fixture's dependencies, and rejects a parameter it cannot destructure. An
    // empty pattern is how "depends on nothing" is spelled.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      await use(await bundlePageAgent());
    },
    { scope: 'worker' },
  ],

  // One renderer per worker, never one per assertion. A browser launch and first
  // navigation dominate the work they enclose by roughly two orders of magnitude
  // — 205 ms cold against 7.5 ms warm (journal 0007) — so a renderer built per
  // subject spends the whole saving before it paints anything.
  varianceRenderer: [
    // eslint-disable-next-line no-empty-pattern -- see `varianceBundle`.
    async ({}, use) => {
      const renderer = await createPlaywrightRenderer();
      await use(renderer);
      await renderer.close();
    },
    { scope: 'worker' },
  ],

  varianceStore: [
    async ({ varianceBaselines }, use) => {
      await use(createDurableStore(varianceBaselines));
    },
    { scope: 'worker' },
  ],

  variance: async ({ page, varianceBundle, varianceRenderer, varianceStore }, use, testInfo) => {
    await page.addInitScript(varianceBundle);

    await use(async (locator, options = {}) => {
      const subject: SubjectRef = {
        id: options.subjectId ?? testInfo.titlePath.slice(1).join('/'),
        kind: options.subjectKind ?? 'route',
      };

      const request: AcquireRequest = {
        subject,
        viewport: viewportOf(page.viewportSize(), testInfo),
        engine: `chromium@${page.context().browser()?.version() ?? 'unknown'}`,
        ...(options.fonts !== undefined ? { fonts: options.fonts } : {}),
        // A deliberate loading capture waits for nothing: the fallback is the
        // subject, and paying the timeout to be told the boundary is still there
        // would add five seconds to every such assertion.
        ...(options.loading === true
          ? { suspense: { timeoutMs: 0 } }
          : options.suspenseTimeoutMs !== undefined
            ? { suspense: { timeoutMs: options.suspenseTimeoutMs } }
            : {}),
      };

      // The element, not a selector: Playwright resolves the locator and hands
      // the node across, which is the whole of what a collector's root search
      // exists to do.
      const raw = await locator.evaluate(
        (element, [global, sent]: readonly [string, AcquireRequest]) => {
          const agent = (globalThis as unknown as Record<string, InstalledAgent | undefined>)[
            global
          ];
          if (agent === undefined) {
            throw new Error(`the variance page agent is not installed at ${global}`);
          }
          return agent.acquire(element, sent);
        },
        [AGENT, request] as const,
      );

      const { document, capture, suspense } = JSON.parse(raw) as Acquired;

      // Thrown, not returned. This surface has no refusal channel — an
      // `Observation` says what a comparison found, and "we photographed a
      // spinner" is not a comparison result — and a failed assertion is what
      // actually reaches the person who can decide which state this test is
      // about. `loading: true` is the way past it.
      const unsettled = suspenseRefusal(suspense, {
        subjectId: subject.id,
        declaredLoading: options.loading === true,
      });
      if (unsettled !== undefined) throw new Error(unsettled);
      const snapshot: SemanticSnapshot = normalize(capture);
      const key: BaselineKey = { subject: subject.id };

      // The settlement query, and it reads no image. `describe` answers from the
      // sidecar — a few hundred bytes of text against a base64-encoded PNG — so a
      // suite where nothing moved decodes nothing and paints nothing. On a
      // Playwright suite that is most runs, which is why this is the first thing
      // that happens and not an optimization bolted on later.
      //
      // `identityFor(document)`, never `renderer.identity`: the two differ by the
      // document's scale factor, and asking under a key nothing was written under
      // switches the whole economy off above 1x while looking healthy.
      const identity = varianceRenderer.identityFor(document);
      const settlement = settle(
        documentDigest(document),
        await varianceStore.describe(key, identity),
        identity,
      );

      if (settlement.kind === 'settled') {
        return {
          subject: subject.id,
          verdict: settlement.verdict,
          because: settlement.because,
          regions: [],
          rendered: false,
          missingFonts: settlement.missingFonts ?? [],
        };
      }

      const observation = await observeAgainstBaseline(document, key, {
        renderer: varianceRenderer,
        store: varianceStore,
        snapshot,
        ...(options.source !== undefined ? { source: options.source } : {}),
      });

      if (accepting(testInfo) && observation.verdict !== 'unchanged') {
        await promote(varianceStore, varianceRenderer, document, key, snapshot);
      }

      return observation;
    });
  },
});

/**
 * Promote the candidate this run already painted.
 *
 * The image is taken from the render cache rather than rendered again, which is
 * not only a saving: re-rendering here would produce a *second* image and store
 * that one, so the bytes a reviewer approved and the bytes that became the
 * baseline would be two different renders that nobody compared. A cache miss is
 * therefore refused rather than papered over — the cache never throws and is
 * allowed to be cold, and "cold" is exactly the case where there is no candidate
 * to promote.
 */
async function promote(
  store: RasterStore,
  renderer: Renderer,
  document: Parameters<typeof documentDigest>[0],
  key: BaselineKey,
  /** This run's snapshot of the same render. See below. */
  snapshot: SemanticSnapshot,
): Promise<void> {
  const identity = renderer.identityFor(document);
  const candidate = await store.renderCache.get(documentDigest(document), identity);

  if (candidate === null) {
    throw new Error(
      `cannot accept \`${key.subject}\`: this run produced no candidate for it. ` +
        'Acceptance promotes an image the run already painted and never paints one',
    );
  }

  // The image comes from the cache and the hashes do not. A render cache is keyed
  // by document digest and holds images; component hashes describe a snapshot,
  // which carries provenance a document does not (ADR-0027). Promoting the cached
  // raster as-is would record a baseline with no hashes at all, so every later run
  // against it would rank regions by area — the ordering journal 0013 measured as
  // backwards — on the one surface where both documents were in hand.
  await store.put(key, { ...candidate, components: hashComponents(snapshot) });
}

export { expect } from './matcher.js';
