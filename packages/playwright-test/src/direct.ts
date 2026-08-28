import type { Locator, Page, TestInfo } from '@playwright/test';
import type { Observation } from '@variance-authority/observe';
import { createPlaywrightRenderer } from '@variance-authority/playwright';
import type { RasterStore, Renderer } from '@variance-authority/raster';
import { createDurableStore } from '@variance-authority/store';
import { bundlePageAgent } from './bundle.js';
import {
  observeLocator,
  type MaterializationOptions,
  type VarianceOptions,
} from './fixture.js';
import {
  createExecutionRecorder,
  ownerOf,
  type ExecutionRecording,
} from './execution.js';
import { AGENT } from './page-agent.js';

export interface CreateVarianceOptions {
  /** Defaults to `.variance/baselines`. */
  readonly baselines?: string;
  /** Supply an existing renderer when the suite already owns its lifetime. */
  readonly renderer?: Renderer;
  /** Supply an existing store when baselines do not live in a directory. */
  readonly store?: RasterStore;
  /** Override only when the suite deliberately builds its own page agent. */
  readonly bundle?: string;
  /** Defaults to deferred document rendering. */
  readonly materialization?: MaterializationOptions;
  /**
   * Record what this session's page executed, for the next run's `--since`.
   *
   * Off by default. The application must be built with `testSelectionProbes()`
   * from `@variance-authority/sense/journal`; without a collector in the page
   * the session says so on stderr and records nothing.
   */
  readonly tests?: boolean | ExecutionRecording;
}

export interface DirectObservationOptions extends VarianceOptions {
  /** Defaults to `.variance/baselines`. */
  readonly baselines?: string;
  /** Defaults to deferred document rendering. */
  readonly materialization?: MaterializationOptions;
  /**
   * Record what this observation executed. Off by default.
   *
   * One-shot: the session it opens closes immediately, so each call merges the
   * index once. A test with several observations should hold a
   * {@link createVariance} session instead and pay that once.
   */
  readonly tests?: boolean | ExecutionRecording;
}

export interface VarianceSession {
  readonly observe: (locator: Locator, options?: VarianceOptions) => Promise<Observation>;
  readonly close: () => Promise<void>;
}

/**
 * Add Variance to the Page and TestInfo the suite already owns.
 *
 * This is deliberately a helper rather than an exported `test`: an extension
 * must not make every existing fixture and matcher route through this package.
 * Callers with several observations may keep the returned renderer alive for
 * the test and close it once; the one-shot {@link observe} does that lifecycle
 * automatically.
 */
export async function createVariance(
  page: Page,
  testInfo: TestInfo,
  options: CreateVarianceOptions = {},
): Promise<VarianceSession> {
  const recorder =
    options.tests === undefined || options.tests === false
      ? undefined
      : createExecutionRecorder(options.tests === true ? {} : options.tests);
  const owner = recorder === undefined ? undefined : ownerOf(process.cwd(), testInfo);
  const bundle = options.bundle ?? (await bundlePageAgent());
  const materialization = options.materialization ?? { kind: 'deferred' };
  const store = options.store ?? createDurableStore(options.baselines ?? '.variance/baselines');
  const ownsRenderer = materialization.kind === 'deferred' && options.renderer === undefined;
  let closed = false;

  // Future navigations receive the agent before application code. The current
  // document receives it as well, because an additive helper is commonly called
  // after the suite has already navigated to the state it wants to inspect.
  await page.addInitScript(bundle);
  const installed = await page.evaluate(
    (global: string) =>
      typeof (globalThis as unknown as Record<string, unknown>)[global] === 'object',
    AGENT,
  );
  if (!installed) await page.evaluate(bundle);

  // Open an owned renderer only after page setup can no longer fail. Before
  // this point no session exists whose `close` the caller could reach.
  const renderer =
    materialization.kind === 'deferred'
      ? options.renderer ?? (await createPlaywrightRenderer())
      : options.renderer;

  return {
    observe: async (locator, varianceOptions) => {
      if (closed) throw new Error('the variance session is closed');
      try {
        return await observeLocator(
          {
            page,
            testInfo,
            store,
            materialization,
            ...(renderer === undefined ? {} : { renderer }),
          },
          locator,
          varianceOptions,
        );
      } catch (error) {
        // A refused observation is an incomplete one, and this is where the
        // helper learns that: unlike the fixture, nothing here will later read
        // the runner's verdict for this test.
        if (owner !== undefined) recorder!.mark(owner, false);
        throw error;
      } finally {
        if (owner !== undefined) await recorder!.note(page, owner);
      }
    },
    close: async () => {
      if (closed) return;
      closed = true;
      await recorder?.close();
      if (ownsRenderer) await renderer!.close();
    },
  };
}

/** Observe one locator without extending or replacing Playwright's test API. */
export async function observe(
  page: Page,
  locator: Locator,
  testInfo: TestInfo,
  options: DirectObservationOptions = {},
): Promise<Observation> {
  const session = await createVariance(page, testInfo, {
    ...(options.baselines === undefined ? {} : { baselines: options.baselines }),
    ...(options.materialization === undefined
      ? {}
      : { materialization: options.materialization }),
    ...(options.tests === undefined ? {} : { tests: options.tests }),
  });
  try {
    return await session.observe(locator, options);
  } finally {
    await session.close();
  }
}
