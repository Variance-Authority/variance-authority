import type {
  Fixtures,
  Locator,
  Page,
  PlaywrightTestArgs,
  PlaywrightWorkerArgs,
} from '@playwright/test';
import { hashComponents, overlaySourceIndex } from '@variance-authority/core/attribute';
import { documentDigest } from '@variance-authority/core/format';
import { normalize } from '@variance-authority/core/rules';
import type { CaptureArtifact } from '@variance-authority/core';
import type { SourceIndex } from '@variance-authority/core/attribute';
import type {
  AccessibilitySnapshot,
  SemanticSnapshot,
  SubjectRef,
  Viewport,
} from '@variance-authority/core/format';
import {
  observeAgainstBaseline,
  observeCaptureAgainstBaseline,
} from '@variance-authority/observe';
import { createDeclarationReader, type DeclarationReader } from '@variance-authority/playwright';
import { createPlaywrightRenderer } from '@variance-authority/playwright/renderer';
import { settle, type BaselineKey, type RasterStore, type Renderer } from '@variance-authority/raster';
import { suspenseRefusal } from '@variance-authority/react';
import { createDurableStore } from '@variance-authority/store/durable';
import { accepted } from './accepted.js';
import type { MaterializationOptions, VarianceOptions } from './options.js';
import { bundlePageAgent } from './bundle.js';
import { acquireFrom } from './acquire.js';
import { runOf, type VarianceRun } from './run.js';
import { settledCapture } from './in-place.js';
import { withEvidence, type Observed } from './evidence.js';
import {
  createExecutionRecorder,
  ownerOf,
  varianceCompletedFixtures,
  type ExecutionRecorder,
  type ExecutionRecording,
  type VarianceCompletedFixtures,
} from './execution.js';
import {
  varianceEventFixtures,
  type VarianceEventFixtures,
  type VarianceEventWorkerFixtures,
} from './events.js';
import { runnerReprieve, varianceDesk, varianceVantageFixtures } from './vantage.js';
import type { VarianceDesk, VarianceVantageFixtures, VarianceVantageWorkerFixtures } from './vantage.js';
import { varianceWireFixtures, type VarianceWireFixtures } from './wire.js';
import { AGENT, type AcquireRequest } from './page-agent.js';

/**
 * The optional Playwright fixture parts, for a suite that already owns a shared
 * extension module.
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
 * (ADR-0003: 1010 rules parsed, 1 reached the normalizer). Handed a page, pruning
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

export interface VarianceFixtures extends VarianceEventFixtures, VarianceVantageFixtures, VarianceCompletedFixtures {
  /**
   * Observe one subtree against its stored baseline — and, on the same name, the
   * two calls that let a test be looked at while it runs.
   *
   * One identifier rather than two, because a test author asking to be seen is
   * not doing a second kind of thing: `variance(heading)` is what this suite
   * checks, `variance.snapshot()` and `await variance.observe()` are what it
   * says while checking it. A second fixture would mean a second thing to
   * destructure before writing the one line somebody needs at two in the
   * morning.
   */
  readonly variance: ((locator: Locator, options?: VarianceOptions) => Promise<Observed>) &
    VarianceDesk;
}

export interface VarianceWorkerFixtures
  extends VarianceEventWorkerFixtures,
    VarianceWireFixtures,
    VarianceVantageWorkerFixtures {
  /**
   * Record what each spec executed, for the next run's `--since`.
   *
   * Off by default, and useless unless the application this suite drives was
   * built with `testSelectionProbes()` from `@variance-authority/sense/journal`
   * — without a collector in the page there is nothing to drain, and the worker
   * says so on stderr rather than writing an index that would exclude specs it
   * never watched.
   */
  readonly varianceExecution: boolean | ExecutionRecording;
  /** The worker's accumulation. Written once, at worker teardown. */
  readonly varianceRecorder: ExecutionRecorder | undefined;
  readonly varianceBundle: string;
  readonly varianceRenderer: Renderer;
  readonly varianceStore: RasterStore;
  readonly varianceBaselines: string;
}

export interface VarianceRuntime {
  readonly page: Page;
  readonly run: VarianceRun;
  readonly renderer?: Renderer;
  readonly store: RasterStore;
  readonly materialization?: MaterializationOptions;
  /**
   * Where the components this page rendered are declared, asked of the engine.
   * Laid over `options.source` for the artifact; absent when nobody opened one.
   */
  readonly declared?: DeclarationReader;
  /**
   * Directory to write the compared images into, for a subject a person will
   * stop on. Absent means write nothing, which is what a suite that never looks
   * at pixels should pay.
   */
  readonly evidence?: string;
}

/**
 * The subject id a run supplies when an observation does not name one.
 *
 * Refused rather than defaulted: an id is the coordinate a baseline is stored
 * at, and inventing one from a counter or a timestamp would give the same
 * subject a different address on every run.
 */
function subjectFromRun(run: VarianceRun): string {
  if (run.id === undefined || run.id === '') {
    throw new Error(
      'variance needs a subject id and this run has none; ' +
        'pass `subjectId` on the observation, or `id` on the run descriptor',
    );
  }
  return run.id;
}

function viewportOf(
  size: { width: number; height: number } | null,
  run: VarianceRun,
): Viewport {
  if (size === null) {
    throw new Error(
      'variance needs a viewport and this page has none; ' +
        'a null viewport means the image has no declared size, so no two runs are comparable',
    );
  }

  return {
    ...size,
    deviceScaleFactor: run.deviceScaleFactor ?? 1,
    colorScheme: run.colorScheme === 'dark' ? 'dark' : 'light',
  };
}

/**
 * Every fixture this package has, as a value rather than as a `test`.
 *
 * A suite extends its own base with it — `base.extend(varianceFixtures)` — which
 * is the only shape that composes with the extension module a project already
 * owns. The worker fixtures below are options: a suite names one in `use` when
 * it supplies its own renderer, store, agent bundle or listening arrangement.
 */
export const varianceFixtures: Fixtures<
  VarianceFixtures,
  VarianceWorkerFixtures,
  PlaywrightTestArgs,
  PlaywrightWorkerArgs
> = {
  ...varianceWireFixtures,
  ...varianceVantageFixtures,
  ...varianceEventFixtures,
  ...varianceCompletedFixtures,

  varianceBaselines: ['.variance/baselines', { scope: 'worker', option: true }],

  varianceExecution: [false, { scope: 'worker', option: true }],

  // One recorder per worker, closed when the worker is: a worker is a process,
  // and a process that wrote the shared index per assertion would spend the run
  // contending for a lock it holds for microseconds of work.
  varianceRecorder: [
    async ({ varianceExecution, varianceWire }, use) => {
      if (varianceExecution === false) {
        await use(undefined);
        return;
      }
      const recorder = createExecutionRecorder(
        varianceExecution === true ? {} : varianceExecution,
        varianceWire,
      );
      await use(recorder);
      await recorder.close();
    },
    { scope: 'worker' },
  ],

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

  variance: async (
    // `varianceJourney` is depended on rather than used: it is what puts the
    // cookie on the context, and it has to be there before the subject
    // navigates — a head cannot be told which execution a request belongs to by
    // an id that arrived after the request did.
    {
      page,
      varianceBundle,
      varianceRenderer,
      varianceStore,
      varianceRecorder,
      varianceJourney,
      varianceVantage,
    },
    use,
    testInfo,
  ) => {
    void varianceJourney;
    await page.addInitScript(varianceBundle);
    const owner = varianceRecorder === undefined ? undefined : ownerOf(process.cwd(), testInfo);
    const declared = createDeclarationReader(page, { global: AGENT });
    const observing = async (locator: Locator, options?: VarianceOptions) => {
      try {
        // The runner already owns a per-test output directory it cleans and
        // reports from, so on this path evidence is on by default and lands
        // where a Playwright user looks for artifacts. The direct helper has no
        // such directory and therefore no such default.
        const observed = await observeLocator(
          {
            page,
            run: runOf(testInfo),
            renderer: varianceRenderer,
            store: varianceStore,
            declared,
            evidence: testInfo.outputPath('variance'),
          },
          locator,
          options,
        );
        for (const [name, path] of Object.entries(observed.evidence ?? {})) {
          await testInfo.attach(`${observed.subject} ${name}`, { path, contentType: 'image/png' });
        }
        return observed;
      } finally {
        // Drained on the way out of a refusal too. A subject that threw still
        // executed code, and counters left in the page would be handed to
        // whichever spec drained next — an attribution that is simply false.
        if (owner !== undefined) await varianceRecorder!.note(page, owner);
      }
    };

    await use(
      Object.assign(
        observing,
        varianceDesk(varianceVantage, testInfo.testId, {
          reprieve: () => runnerReprieve(testInfo),
        }),
      ),
    );
    await declared.close();
  },
};

async function sourceOf(
  runtime: VarianceRuntime,
  given: SourceIndex | undefined,
): Promise<SourceIndex | undefined> {
  const engine = await runtime.declared?.read();
  if (engine === undefined || Object.keys(engine).length === 0) return given;
  return overlaySourceIndex(given ?? {}, engine);
}

export async function observeLocator(
  runtime: VarianceRuntime,
  locator: Locator,
  options: VarianceOptions = {},
): Promise<Observed> {
  const { page, run, renderer, store } = runtime;
  const subject: SubjectRef = {
    id: options.subjectId ?? subjectFromRun(run),
    kind: options.subjectKind ?? 'route',
  };

  // Read before the request is built: in-place capture photographs this very
  // document, so its acquisition is the only one whose sheet has to hold a caret
  // still. See `AcquireRequest.tier`.
  const materialization = runtime.materialization ?? { kind: 'deferred' };

  const request: AcquireRequest = {
    subject,
    ...(materialization.kind === 'in-place' ? { tier: 'raster' as const } : {}),
    viewport: viewportOf(page.viewportSize(), run),
    engine: engineOf(page),
    ...(options.fonts !== undefined ? { fonts: options.fonts } : {}),
    ...(options.loading === true
      ? { suspense: { timeoutMs: 0 } }
      : options.suspenseTimeoutMs !== undefined
        ? { suspense: { timeoutMs: options.suspenseTimeoutMs } }
        : {}),
    // Sent only when the test said something. The page agent holds the defaults,
    // so a bundle and a driver built from different checkouts cannot disagree
    // about what absent meant.
    ...(options.wiring !== undefined ? { wiring: options.wiring } : {}),
    ...(options.holdings !== undefined ? { holdings: options.holdings } : {}),
  };

  const acquired = await acquireFrom(page, locator, request);
  const { document, capture, suspense, accessibility } = acquired;

  // The engine's answer laid over the caller's index, read after the acquisition
  // that registered this subject's components. Absent altogether when neither
  // has anything to say, so an artifact without a source index stays one.
  const source = await sourceOf(runtime, options.source);
  const unsettled = suspenseRefusal(suspense, {
    subjectId: subject.id,
    declaredLoading: options.loading === true,
  });
  if (unsettled !== undefined) throw new Error(unsettled);
  const snapshot: SemanticSnapshot = normalize(capture);
  const key: BaselineKey = { subject: subject.id };

  if (materialization.kind === 'in-place') {
    const { held, snapshot: heldSnapshot, raster: candidate } = await settledCapture(
      { page, locator, request, materialization },
      { acquired, snapshot },
      { subjectId: subject.id, fonts: options.fonts ?? [], loading: options.loading === true },
    );
    const artifact: CaptureArtifact = {
      artifactVersion: 1,
      subject,
      material: { kind: 'raster', raster: candidate },
      snapshot: heldSnapshot,
      accessibility: held.accessibility,
      ...(source === undefined ? {} : { source }),
      stabilization: held.stabilization.ids,
    };
    const observation = await observeCaptureAgainstBaseline(artifact, key, {
      store,
      ...(options.sensitivity === undefined ? {} : { sensitivity: options.sensitivity }),
    });
    if (run.accepting === true && observation.verdict !== 'unchanged') {
      await store.put(key, {
        ...candidate,
        components: hashComponents(heldSnapshot),
        accessibility: held.accessibility,
      });
      return accepted(observation);
    }
    return await withEvidence(runtime, key, observation, async () => candidate);
  }

  if (renderer === undefined) throw new Error('deferred capture needs a renderer');
  const identity = renderer.identityFor(document);
  const described = await store.describe(key, identity);
  const settlement = settle(
    documentDigest(document),
    described,
    identity,
    accessibility,
  );

  if (settlement.kind === 'settled') {
    return {
      subject: subject.id,
      verdict: settlement.verdict,
      because: settlement.because,
      regions: [],
      rendered: false,
      missingFonts: settlement.missingFonts ?? [],
      ...(settlement.verdict === 'unchanged' && described?.accessibility !== undefined
        ? {
            signals: {
              document: 'unchanged' as const,
              pixels: 'unchanged' as const,
              accessibility: {
                verdict: 'unchanged' as const,
                before: described.accessibility,
                after: accessibility,
              },
            },
          }
        : {}),
    };
  }

  const observation = await observeAgainstBaseline(document, key, {
    renderer,
    store,
    snapshot,
    accessibility,
    ...(source !== undefined ? { source } : {}),
    ...(options.sensitivity === undefined ? {} : { sensitivity: options.sensitivity }),
  });

  if (run.accepting === true && observation.verdict !== 'unchanged') {
    await promote(store, renderer, document, key, snapshot, accessibility);
    return accepted(observation);
  }

  return await withEvidence(runtime, key, observation, () =>
    store.renderCache.get(documentDigest(document), identity),
  );
}

function engineOf(page: Page): string {
  const browser = page.context().browser();
  const name = browser?.browserType().name() ?? 'browser';
  return `${name}@${browser?.version() ?? 'unknown'}`;
}

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
  accessibility: AccessibilitySnapshot,
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
  await store.put(key, {
    ...candidate,
    components: hashComponents(snapshot),
    accessibility,
  });
}
