import type { Locator, Page } from '@playwright/test';
import {
  accessibilitySnapshot,
  type AccessibilitySnapshot,
} from '@variance-authority/core';
import {
  ACCESSIBILITY_ROOT_ATTRIBUTE,
  AGENT,
  type Acquired,
  type AcquireRequest,
  type InstalledAgent,
} from './page-agent.js';

/** Acquire semantic material and the browser-native accessibility roots together. */
export async function acquireFrom(
  page: Page,
  locator: Locator,
  request: AcquireRequest,
): Promise<Acquired & { readonly accessibility: AccessibilitySnapshot }> {
  const raw = await locator.evaluate(
    (element, [global, sent]: readonly [string, AcquireRequest]) => {
      const agent = (globalThis as unknown as Record<string, InstalledAgent | undefined>)[global];
      if (agent === undefined) throw new Error(`the variance page agent is not installed at ${global}`);
      return agent.acquire(element, sent);
    },
    [AGENT, request] as const,
  );
  const acquired = JSON.parse(raw) as Acquired;

  try {
    const roots = [await locator.ariaSnapshot()];
    for (const portal of acquired.accessibilityPortals) {
      roots.push(
        await page.locator(`[${ACCESSIBILITY_ROOT_ATTRIBUTE}="${portal.marker}"]`).ariaSnapshot(),
      );
    }
    return { ...acquired, accessibility: accessibilitySnapshot(request.engine, roots) };
  } finally {
    await page.evaluate(
      ([attribute, portals]) => {
        for (const portal of portals) {
          const element = document.querySelector(`[${attribute}="${portal.marker}"]`);
          if (element === null) continue;
          if (portal.previous === undefined) element.removeAttribute(attribute);
          else element.setAttribute(attribute, portal.previous);
        }
      },
      [ACCESSIBILITY_ROOT_ATTRIBUTE, acquired.accessibilityPortals] as const,
    );
  }
}
