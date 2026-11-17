// The stable era: no request in flight, nothing marked busy, nothing the app
// announced started and not ended, and the main thread idle. Asked twice in a
// row, so a quiet moment between two pieces of work is not taken for the end.
import type { Page } from '@playwright/test';

export interface Signals {
  /** Announced work still open, from the `events` fixture. */
  readonly events?: { readonly pending: readonly unknown[] };
  readonly timeout?: number;
}

// An ablation switch for the prototype: which signals the stable era rests on.
const dropped = new Set((process.env.BROKER_DROP ?? '').split(',').filter(Boolean));

const inflight = new WeakMap<Page, Set<unknown>>();

/** Starts counting a page's requests; call before the first navigation. */
export function watch(page: Page): void {
  const open = new Set<unknown>();
  inflight.set(page, open);
  page.on('request', (request) => open.add(request));
  page.on('requestfinished', (request) => open.delete(request));
  page.on('requestfailed', (request) => open.delete(request));
}

export async function settle(page: Page, signals: Signals = {}): Promise<void> {
  const deadline = Date.now() + (signals.timeout ?? 10_000);
  let quiet = 0;
  let last = '';
  while (quiet < 2) {
    if (Date.now() > deadline) throw new Error(`the page never settled: ${last}`);
    const busy = dropped.has('busy') ? 0 : await quietPage(page);
    const network = dropped.has('network') ? 0 : (inflight.get(page)?.size ?? 0);
    const pending = dropped.has('events') ? 0 : (signals.events?.pending.length ?? 0);
    if (dropped.has('busy')) await page.evaluate(() => new Promise((resolve) => requestIdleCallback(resolve))).catch(() => {});
    last = [
      busy > 0 ? `${busy} marked busy` : '',
      network > 0 ? `${network} requests in flight` : '',
      pending > 0 ? `${pending} announced and not ended` : '',
    ]
      .filter(Boolean)
      .join(', ');
    quiet = last === '' ? quiet + 1 : 0;
  }
}

// Waits for an idle main thread, then counts what is marked busy. A navigation
// in progress destroys the context; that is not quiet, and is asked again.
async function quietPage(page: Page): Promise<number> {
  try {
    return await page.evaluate(
      () =>
        new Promise<number>((resolve) =>
          requestIdleCallback(() => resolve(document.querySelectorAll('[aria-busy="true"]').length), {
            timeout: 500,
          }),
        ),
    );
  } catch {
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    return 1;
  }
}
