import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { RawCapture, Viewport } from '@variance-authority/core';
import { AGENT_GLOBAL, type CaptureRequest, type PageAgent } from './agent.js';

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

export interface HarnessOptions {
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
  readonly features?: Readonly<Record<string, string>>;
  readonly assets?: Readonly<Record<string, string>>;

  /** Defaults to `fixture:<subject>`, matching the JSDOM measurement. */
  readonly subjectId?: (subject: string) => string;

  /** Defaults to `true`. Set false to watch a case that is behaving oddly. */
  readonly headless?: boolean;
}

export interface Harness {
  /** `chromium@<version>`, as it lands in the environment key. */
  readonly engine: string;

  /**
   * Render `(subject, variant)` in the shared page and return its capture.
   *
   * Sequential by contract. Two concurrent calls would render two subjects into
   * one document and let one decide the other's verdict.
   */
  capture(subject: string, variant: string): Promise<RawCapture>;

  /** Console errors the page reported, in order. Empty is the expected case. */
  pageErrors(): readonly string[];

  /** Escape hatch for debugging a case by hand. Not part of the capture path. */
  readonly page: Page;

  close(): Promise<void>;
}

export async function createHarness(options: HarnessOptions): Promise<Harness> {
  const browser = await chromium.launch({ headless: options.headless ?? true });
  const errors: string[] = [];

  try {
    const context = await newContext(browser, options.viewport);
    const page = await context.newPage();

    // A bundle that throws leaves the agent global undefined, and the failure
    // then surfaces as a timeout with no cause. Recording page-side errors turns
    // that into the actual exception text.
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    await page.goto(options.url, { waitUntil: 'load' });
    await installAgent(page, options.bundle, errors);

    const engine = `chromium@${browser.version()}`;
    const subjectId = options.subjectId ?? ((subject: string) => `fixture:${subject}`);

    return {
      engine,
      page,
      pageErrors: () => [...errors],
      async capture(subject, variant) {
        return evaluateCapture(page, {
          subject,
          variant,
          subjectId: subjectId(subject),
          viewport: options.viewport,
          engine,
          ...(options.fonts ? { fonts: options.fonts } : {}),
          ...(options.features ? { features: options.features } : {}),
          ...(options.assets ? { assets: options.assets } : {}),
        });
      },
      async close() {
        await browser.close();
      },
    };
  } catch (error) {
    // The browser is a child process; an exception between launch and return
    // would otherwise leave it running for the life of the test runner.
    await browser.close();
    throw error;
  }
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

async function newContext(browser: Browser, viewport: Viewport): Promise<BrowserContext> {
  return browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor,
    // Declared, never inherited from the host OS. The same case must not render
    // on a white canvas here and a black one on someone else's machine; that is
    // an undeclared render input, and the environment key can only cover inputs
    // somebody decided (spec §11.1).
    colorScheme: viewport.colorScheme,
  });
}

async function installAgent(page: Page, bundle: string, errors: readonly string[]): Promise<void> {
  await page.addScriptTag({ content: bundle });

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
