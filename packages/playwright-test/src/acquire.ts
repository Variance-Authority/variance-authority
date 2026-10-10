import type { Locator, Page } from '@playwright/test';
import { accessibilitySnapshot, type AccessibilitySnapshot } from '@variance-authority/core/format';
import {
  ACCESSIBILITY_ROOT_ATTRIBUTE,
  AGENT,
  type Acquired,
  type AcquireRequest,
  type InstalledAgent,
} from './page-agent.js';

/**
 * Acquire semantic material and the browser-native accessibility roots together.
 *
 * `captured` runs the moment the page agent's document arrives, before the
 * accessibility roots are read: anything it reads is what held when the
 * document was taken, not what was said while the roots were still awaited.
 */
export async function acquireFrom(
  page: Page,
  locator: Locator,
  request: AcquireRequest,
  captured?: () => void,
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
  captured?.();

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

/**
 * Start the page agent recording changes to the subject, for the next
 * `acquireFrom` to report as `mutated`.
 *
 * A separate call from the read before it leaves no gap a screenshot can fall
 * into: a state photographed after this call and gone by the next read was left
 * after this call, and leaving it is a change the watch records.
 */
export async function watchFrom(locator: Locator): Promise<void> {
  await locator.evaluate((element, global) => {
    const agent = (globalThis as unknown as Record<string, InstalledAgent | undefined>)[global];
    if (agent === undefined) throw new Error(`the variance page agent is not installed at ${global}`);
    agent.watch(element);
  }, AGENT);
}

/** Stop a watch `acquireFrom` did not take, on a page that is still open. */
export async function unwatchFrom(page: Page): Promise<void> {
  if (page.isClosed()) return;
  await page.evaluate((global) => {
    (globalThis as unknown as Record<string, InstalledAgent | undefined>)[global]?.unwatch();
  }, AGENT);
}
