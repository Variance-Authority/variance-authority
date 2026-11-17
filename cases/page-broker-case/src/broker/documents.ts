// Which document the main frame shows, known by a mark each document carries.
// A history push or a hash change navigates the frame and keeps its document,
// mark and every handle on it, even while a request for another is in flight;
// any navigation that replaced the document, requested or not — about:blank, a
// data: URL — shows a document with no mark of ours, and gets a fresh one.
import type { Page } from '@playwright/test';

export class Documents {
  /** Documents the main frame has loaded so far. */
  count = 0;
  /** Resolves once the latest navigation is counted; ask it before trusting `count`. */
  counted: Promise<void> = Promise.resolve();
  private mark: unknown;

  constructor(page: Page) {
    // An unreadable document is a new one: keeping a stale handle is the worse mistake.
    const read = () => page.evaluate(() => ((globalThis as any).__brokerDocument ??= Math.random())).catch(() => NaN);
    // The document already loaded is the first one: a broker started on it keeps it through a history push.
    this.counted = read().then((mark) => void (this.mark = mark));
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame()) return;
      this.counted = this.counted.then(async () => {
        const mark = await read();
        // Every new document gets a fresh mark, requested or not; a history push keeps the one it had, whatever is still loading.
        if (mark !== this.mark) this.count += 1;
        this.mark = mark;
      });
    });
  }
}
