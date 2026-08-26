import type { Locator, Page } from '@playwright/test';
import { accessibilitySnapshot } from '@variance-authority/core';
import type { PaintLayer, PresentationReport } from './model.js';
import { analyzePresentation } from './analyze.js';
import {
  PRESENTATION_AGENT,
  PRESENTATION_ROOT_ATTRIBUTE,
  type InstalledPresentationAgent,
  type PresentationAcquireRequest,
  type PresentationAcquired,
} from './browser-agent.js';
import { bundlePresentationAgent } from './bundle.js';

export interface SensePresentationOptions {
  readonly subjectId?: string;
  readonly title?: string;
  readonly fonts?: readonly string[];
  readonly suspense?: { readonly timeoutMs?: number };
  /** `true` paints every layer; a layer list paints only those measurements. */
  readonly paint?: boolean | readonly PaintLayer[];
}

/** Sense and optionally paint one locator without creating a baseline or verdict. */
export async function sensePresentation(
  page: Page,
  locator: Locator,
  options: SensePresentationOptions = {},
): Promise<PresentationReport> {
  await install(page);
  const viewport = page.viewportSize() ?? (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })));
  const environment = await page.evaluate(() => ({
    deviceScaleFactor: devicePixelRatio,
    colorScheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' as const : 'light' as const,
  }));
  const browser = page.context().browser();
  const request: PresentationAcquireRequest = {
    subject: {
      id: options.subjectId ?? 'presentation',
      kind: 'fixture',
      ...(options.title === undefined ? {} : { title: options.title }),
    },
    viewport: { ...viewport, ...environment },
    engine: browser === null ? 'browser@unknown' : `${browser.browserType().name()}@${browser.version()}`,
    ...(options.fonts === undefined ? {} : { fonts: options.fonts }),
    ...(options.suspense === undefined ? {} : { suspense: options.suspense }),
  };
  const raw = await locator.evaluate(
    (element, [global, sent]: readonly [string, PresentationAcquireRequest]) => {
      const agent = (globalThis as unknown as Record<string, InstalledPresentationAgent | undefined>)[global];
      if (agent === undefined) throw new Error(`the presentation sensing agent is not installed at ${global}`);
      return agent.acquire(element, sent);
    },
    [PRESENTATION_AGENT, request] as const,
  );
  const acquired = JSON.parse(raw) as PresentationAcquired;
  try {
    const roots = [await locator.ariaSnapshot()];
    for (const portal of acquired.portals) {
      roots.push(await page.locator(`[${PRESENTATION_ROOT_ATTRIBUTE}="${portal.marker}"]`).ariaSnapshot());
    }
    const report = analyzePresentation(acquired.capture, {
      accessibility: accessibilitySnapshot(request.engine, roots),
    });
    if (options.paint !== undefined && options.paint !== false) {
      const layers = options.paint === true ? undefined : options.paint;
      await page.evaluate(
        ([global, instructions, selected]) => {
          const agent = (globalThis as unknown as Record<string, InstalledPresentationAgent | undefined>)[global];
          if (agent === undefined) throw new Error(`the presentation sensing agent is not installed at ${global}`);
          return agent.paint(instructions, selected);
        },
        [PRESENTATION_AGENT, report.paint ?? [], layers] as const,
      );
    }
    return report;
  } finally {
    await restorePortals(page, acquired);
  }
}

/** Remove diagnostic paint without changing the sensed application. */
export async function clearPresentationPaint(page: Page): Promise<void> {
  await page.evaluate((global) => {
    const agent = (globalThis as unknown as Record<string, InstalledPresentationAgent | undefined>)[global];
    agent?.clear();
  }, PRESENTATION_AGENT);
}

async function install(page: Page): Promise<void> {
  const bundle = await bundlePresentationAgent();
  await page.addInitScript(bundle);
  const installed = await page.evaluate(
    (global) => typeof (globalThis as unknown as Record<string, unknown>)[global] === 'object',
    PRESENTATION_AGENT,
  );
  if (!installed) await page.evaluate(bundle);
}

async function restorePortals(page: Page, acquired: PresentationAcquired): Promise<void> {
  await page.evaluate(
    ([attribute, portals]) => {
      for (const portal of portals) {
        const element = document.querySelector(`[${attribute}="${portal.marker}"]`);
        if (element === null) continue;
        if (portal.previous === undefined) element.removeAttribute(attribute);
        else element.setAttribute(attribute, portal.previous);
      }
    },
    [PRESENTATION_ROOT_ATTRIBUTE, acquired.portals] as const,
  );
}
