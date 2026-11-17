import type { Page } from '@playwright/test';
import { PAGE } from './shop-page.js';

// A page that paints a headline, holds a frame on one click and moves its
// layout on another. It watches what the browser reports of its frames itself,
// so a spec waits for a report rather than for a guessed time.
export const FRAMED = `<script>
globalThis.reported = new Set();
const watch = new PerformanceObserver((list) => list.getEntries().forEach((entry) => reported.add(entry.entryType)));
for (const type of ['paint', 'largest-contentful-paint', 'layout-shift', 'long-animation-frame']) watch.observe({ type, buffered: true });
</script>
${PAGE}
<h1 class="title">Tea and cake, fresh every morning</h1>
<button id="hold" onclick="shop.choose('cake'); for (const end = performance.now() + 120; performance.now() < end; );">Hold</button>
<button id="push" onclick="document.body.prepend(Object.assign(document.createElement('div'), { style: 'height: 300px' }))">Push</button>`;

/** Resolves once the page has reported an entry of `type`. */
export async function reported(page: Page, type: string): Promise<void> {
  await page.waitForFunction((seen) => (globalThis as unknown as { reported: Set<string> }).reported.has(seen), type);
}
