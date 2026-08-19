import type { Locator, Page, TestInfo } from '@playwright/test';
import type { Observation } from '@variance-authority/observe';
import { createPlaywrightRenderer } from '@variance-authority/playwright';
import type { RasterStore, Renderer } from '@variance-authority/raster';
import { createDurableStore } from '@variance-authority/store';
import { bundlePageAgent } from './bundle.js';
import { observeLocator, type VarianceOptions } from './fixture.js';
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
}

export interface DirectObservationOptions extends VarianceOptions {
  /** Defaults to `.variance/baselines`. */
  readonly baselines?: string;
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
  const bundle = options.bundle ?? (await bundlePageAgent());
  const renderer = options.renderer ?? (await createPlaywrightRenderer());
  const store = options.store ?? createDurableStore(options.baselines ?? '.variance/baselines');
  const ownsRenderer = options.renderer === undefined;
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

  return {
    observe: async (locator, varianceOptions) => {
      if (closed) throw new Error('the variance session is closed');
      return observeLocator(
        { page, testInfo, renderer, store },
        locator,
        varianceOptions,
      );
    },
    close: async () => {
      if (closed) return;
      closed = true;
      if (ownsRenderer) await renderer.close();
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
  const session = await createVariance(
    page,
    testInfo,
    options.baselines === undefined ? {} : { baselines: options.baselines },
  );
  try {
    return await session.observe(locator, options);
  } finally {
    await session.close();
  }
}
