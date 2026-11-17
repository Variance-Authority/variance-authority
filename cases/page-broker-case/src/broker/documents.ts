// Which document the main frame shows. A history push or a hash change
// navigates the frame and keeps its document, and every handle on it; a
// navigation that requested a document replaced it, and so did one without a
// request — about:blank, a data: URL — whose document carries no mark of ours.
import type { Page, Request } from '@playwright/test';

export class Documents {
  /** Documents the main frame has loaded so far. */
  count = 0;
  /** Resolves once the latest navigation is counted; ask it before trusting `count`. */
  counted: Promise<void> = Promise.resolve();
  private loading: Request | undefined;
  private mark: unknown;

  constructor(page: Page) {
    // An unreadable document is a new one: keeping a stale handle is the worse mistake.
    const read = () => page.evaluate(() => ((globalThis as any).__brokerDocument ??= Math.random())).catch(() => NaN);
    // The document already loaded is the first one: a broker started on it keeps it through a history push.
    this.counted = read().then((mark) => void (this.mark = mark));
    page.on('request', (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) this.loading = request;
    });
    const ended = (request: Request) => {
      if (request === this.loading) this.loading = undefined;
    };
    page.on('requestfinished', ended);
    page.on('requestfailed', ended);
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame()) return;
      const requested = this.loading !== undefined;
      this.loading = undefined;
      if (requested) this.count += 1;
      this.counted = this.counted.then(async () => {
        const mark = await read();
        if (!requested && mark !== this.mark) this.count += 1;
        this.mark = mark;
      });
    });
  }
}
