import type { BrowserContextOptions, Page } from 'playwright';
import {
  driveBeforeLoad,
  featuresOf,
  forDriver,
  type PageRegion,
  type RawCapture,
  type Recipe,
  type Viewport,
} from '@variance-authority/core/format';
import { AGENT_GLOBAL, type CaptureRequest, type PageAgent } from './agent.js';
import { watchArrivals } from './arrivals.js';
import { leaseBrowser, leaseContext, ownBrowser, ownContext, type Launch } from './browsers.js';
import { observeNetwork, type NetworkObservation, type NetworkOptions } from './network.js';
import { CHROMIUM_RASTER_ARGS } from './renderer.js';
import { pinnedRegion } from './viewport.js';

/**
 * A persistent Chromium harness: one browser, one page, one navigation, one
 * bundle injection, N captures.
 *
 * The economic claim of this project is that a semantic capture costs less than a
 * screenshot. A harness that spawns a browser per subject spends that saving
 * before it collects anything — process launch and first navigation dominate the
 * capture itself by roughly two orders of magnitude (see
 * `journal/0007-persistent-harness-and-p4.md` for the measurement). So the
 * expensive steps happen once and subjects are switched by calling into the page,
 * which is the difference between "cheaper than a screenshot" being an argument
 * and being a number.
 *
 * The cost of that decision is stated rather than hidden: subjects share a
 * document. Sharing one is only safe because the page agent is required to tear
 * down the previous subject completely — see {@link HarnessOptions.bundle}. A
 * bundle that leaks a stylesheet between subjects makes the *next* subject's
 * `unchanged` verdict vacuous, which is exactly the failure ADR-0003 is about.
 */

export interface HarnessOptions extends PageRegion {
  /** Page to navigate to, once. `file://` is fine and needs no server. */
  readonly url: string;

  /**
   * JavaScript source installing a {@link PageAgent} at {@link AGENT_GLOBAL}.
   *
   * Injected as a classic script, so it must be an IIFE bundle rather than ESM —
   * a module would be evaluated asynchronously and the harness would have to poll
   * for the global instead of failing immediately when the bundle is broken.
   *
   * The agent owns subject teardown. The harness cannot do it: it does not know
   * what the previous subject installed.
   */
  readonly bundle: string;

  readonly viewport: Viewport;

  /** See {@link CaptureRequest.fonts}. Omitted means the capture says so. */
  readonly fonts?: readonly string[];
  /**
   * Media features the project declares, such as `prefers-reduced-motion`.
   * A declared motion preference is the one {@link HarnessOptions.stabilize}'s
   * `reduced-motion` emulates.
   */
  readonly features?: Readonly<Record<string, string>>;
  readonly assets?: Readonly<Record<string, string>>;

  /**
   * The stabilization recipe whose driver tricks — reduced motion, a fixed
   * clock, the pointer off the page — are applied before the first navigation.
   * Absent drives nothing. The ids applied are {@link Harness.driven}.
   */
  readonly stabilize?: Recipe;

  /** Defaults to `fixture:<subject>`, matching the JSDOM measurement. */
  readonly subjectId?: (subject: string) => string;

  /** Defaults to `true`. Set false to watch a case that is behaving oddly. */
  readonly headless?: boolean;

  /**
   * Open the page in a context shared with every other harness of the same
   * viewport and region on the same browser. Defaults to `false`.
   *
   * The context is the browser's HTTP cache, so a page booted in one that
   * another page already filled is answered from memory: the second worker of a
   * run does not fetch the preview again. The pages also share cookies and
   * storage, which is why it is asked for rather than given.
   */
  readonly warm?: boolean;

  /**
   * Launch a browser of this harness's own instead of leasing the process's
   * shared one. Defaults to `false`.
   *
   * For a reading whose point is that nothing else has touched its world. Every
   * other harness shares one browser per launch recipe, which is what keeps a
   * run with workers at one launch.
   */
  readonly isolated?: boolean;

  /**
   * Run against the page *before* it is navigated for the first time.
   *
   * The hook exists because of a class of thing that has to be installed before
   * a load rather than after one: `observeNetwork` watches requests, and a
   * watcher attached after `goto` has already missed every asset the document
   * pulled in. The alternative — attach afterwards and reload — pays a second
   * page load per run to observe the first one, on every subject of every suite.
   *
   * Deliberately a hook and not a `network` option. The harness owns a browser
   * and nothing else; teaching it what an asset hash is would put a second
   * decision about the environment key in a file whose job is a page.
   */
  readonly prepare?: (page: Page) => Promise<void>;
}

export interface Harness {
  /** `chromium@<version>`, as it lands in the environment key. */
  readonly engine: string;

  /**
   * The timezone and locale the page was opened in, as they land in the
   * environment key: the declared pair, or `UTC` and `en-US`.
   */
  readonly region: Required<PageRegion>;

  /**
   * Render `(subject, variant)` in the shared page and return its capture.
   *
   * Sequential by contract. Two concurrent calls would render two subjects into
   * one document and let one decide the other's verdict.
   */
  capture(subject: string, variant: string): Promise<RawCapture>;

  /**
   * The driver tricks applied before the first navigation, for the page agent
   * to keep in the recipe it records. Empty when nothing was driven.
   */
  readonly driven: readonly string[];

  /** Console errors the page reported, in order. Empty is the expected case. */
  pageErrors(): readonly string[];

  /** Escape hatch for debugging a case by hand. Not part of the capture path. */
  readonly page: Page;

  close(): Promise<void>;
}

export async function createHarness(options: HarnessOptions): Promise<Harness> {
  // Laid out under the text settings the renderer paints with, or a line that
  // fits here wraps there and the painted page is a different height. The same
  // settings are what let the renderer lease this browser rather than launch
  // its own.
  const launch: Launch = { headless: options.headless ?? true, args: CHROMIUM_RASTER_ARGS };
  const browser = options.isolated === true ? await ownBrowser('chromium', launch) : await leaseBrowser('chromium', launch);
  const errors: string[] = [];
  const region = pinnedRegion(options);
  const contextOptions = contextOptionsFor(options.viewport, region);

  let context: Awaited<ReturnType<typeof leaseContext>> | undefined;
  let page: Page | undefined;
  // In reverse of opening: the page, then the context if this was its last
  // page, then the browser if this was its last holder.
  const close = async (): Promise<void> => {
    try {
      await page?.close();
    } finally {
      try {
        await context?.release();
      } finally {
        await browser.release();
      }
    }
  };

  try {
    context =
      options.warm === true && options.isolated !== true
        ? await leaseContext(browser.value, contextOptions)
        : await ownContext(browser.value, contextOptions);
    const opened = await context.value.newPage();
    page = opened;

    // A bundle that throws leaves the agent global undefined, and the failure
    // then surfaces as a timeout with no cause. Recording page-side errors turns
    // that into the actual exception text.
    opened.on('pageerror', (error) => errors.push(String(error)));
    opened.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    // Before `prepare` and the first navigation, because all three driver
    // tricks survive one and the page's first script already reads the clock
    // and the motion preference.
    const driven =
      options.stabilize === undefined ? [] : await driveBeforeLoad(options.stabilize, opened, options.features);
    const features = featuresOf(forDriver(options.stabilize ?? [], driven), options.features);
    if (options.prepare !== undefined) await options.prepare(opened);

    // After the driver tricks, so the agent's first read of the clock is
    // already the driven one, and before the navigation, so the first document
    // gets the agent ahead of its own scripts as every later one does.
    await opened.addInitScript({ content: options.bundle });
    await opened.goto(options.url, { waitUntil: 'load' });
    await checkAgent(opened, errors);

    const engine = `chromium@${browser.value.version()}`;
    const subjectId = options.subjectId ?? ((subject: string) => `fixture:${subject}`);

    return {
      engine,
      region,
      page: opened,
      driven,
      pageErrors: () => [...errors],
      async capture(subject, variant) {
        return evaluateCapture(opened, {
          subject,
          variant,
          subjectId: subjectId(subject),
          viewport: options.viewport,
          engine,
          ...region,
          ...(options.fonts ? { fonts: options.fonts } : {}),
          ...(features ? { features } : {}),
          ...(options.assets ? { assets: options.assets } : {}),
        });
      },
      close,
    };
  } catch (error) {
    // The browser is a child process; an exception between launch and return
    // would otherwise leave it running, or leased, for the life of the caller.
    await close();
    throw error;
  }
}

/**
 * A harness whose page is watched from before its first navigation: by
 * {@link observeNetwork} when `network` asks for it, and always by
 * {@link watchArrivals}, which a page agent asks what is still arriving.
 *
 * The observation is the caller's to close, before the harness: it outlives the
 * harness's `prepare`, which is where it has to start, because a watcher
 * installed after `goto` has missed every asset the document pulled in.
 */
export async function createObservedHarness(
  options: Omit<HarnessOptions, 'prepare'>,
  network: NetworkOptions | undefined,
): Promise<{ readonly harness: Harness; readonly network?: NetworkObservation }> {
  let observation: NetworkObservation | undefined;
  const harness = await createHarness({
    ...options,
    prepare: async (page): Promise<void> => {
      await watchArrivals(page);
      if (network !== undefined) observation = await observeNetwork(page, network);
    },
  });
  return observation === undefined ? { harness } : { harness, network: observation };
}

/**
 * One capture with nothing reused: launch, navigate, inject, collect, close.
 *
 * This is the cost the persistent harness exists to avoid, kept in the shipped
 * code rather than only in the benchmark so that the comparison measures the same
 * capture path on both sides. A benchmark whose slow arm is a bespoke script
 * measures the script.
 */
export async function captureOnce(
  options: HarnessOptions,
  subject: string,
  variant: string,
): Promise<RawCapture> {
  const harness = await createHarness(options);
  try {
    return await harness.capture(subject, variant);
  } finally {
    await harness.close();
  }
}

function contextOptionsFor(viewport: Viewport, region: Required<PageRegion>): BrowserContextOptions {
  return {
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor,
    // Declared, never inherited from the host OS. The same case must not render
    // on a white canvas here and a black one on someone else's machine; that is
    // an undeclared render input, and the environment key can only cover inputs
    // somebody decided (spec §11.1). The timezone and the language likewise.
    colorScheme: viewport.colorScheme,
    ...region,
  };
}

/**
 * Whether the agent arrived. An init script installs it into every document of
 * the page.
 *
 * Ahead of the page's scripts rather than after them, the first document
 * included. An agent that has to see something from the start — React's commit
 * stream, which `react-dom` only reports to a hook that existed when it loaded —
 * missed it on the first document when the agent arrived there by script tag
 * once the page had loaded, and only that document, so a run read its first
 * subject with less than every other one.
 *
 * And into every document, not only the first. There should not be a
 * navigation — a session is one load and N subjects, and that is the whole
 * economic argument. But the page is not this harness's to control: a Storybook
 * preview reloads itself when a render it is replacing is still pending, a
 * subject can set `location`, and a driver that assumed otherwise reported the
 * truthful but useless `missing page agent __variance_authority_page_agent__`
 * for every subject after the first one that reloaded. Losing the session's
 * accumulated state to a reload is a weaker reading; losing the agent is no
 * reading at all.
 */
async function checkAgent(page: Page, errors: readonly string[]): Promise<void> {
  const installed = await page.evaluate(
    (global) => typeof (window as unknown as Record<string, unknown>)[global] === 'object',
    AGENT_GLOBAL,
  );

  if (!installed) {
    throw new Error(
      `page bundle did not install ${AGENT_GLOBAL}` +
        (errors.length > 0 ? `\n  page errors:\n    ${errors.join('\n    ')}` : ''),
    );
  }
}

async function evaluateCapture(page: Page, request: CaptureRequest): Promise<RawCapture> {
  const json = await page.evaluate(
    ([global, payload]) => {
      const agent = (window as unknown as Record<string, PageAgent>)[global as string];
      if (agent === undefined) throw new Error(`missing page agent ${String(global)}`);
      return agent.capture(payload as CaptureRequest);
    },
    [AGENT_GLOBAL, request] as const,
  );

  // Parsed here rather than returned as an object from `evaluate` on purpose:
  // the round trip through text is the property ADR-0002's sub-renderer protocol
  // depends on, and a structured clone would let a non-serializable capture pass.
  return JSON.parse(json) as RawCapture;
}
