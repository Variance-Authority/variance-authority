// compass: variance-authority.reach.crossings
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ViewData } from './view-data.js';
import type { Coverage } from './coverage.js';
import { viewPage } from './view-page.js';

/**
 * The page `variance view` writes, opened from a file in a browser: the tabs
 * route by address, the filter narrows a view's rows, a header sorts, and the
 * page asks the network for nothing.
 */

const BROWSER_AVAILABLE = ((): boolean => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

if (!BROWSER_AVAILABLE) {
  console.warn(
    '\npackages/cli view page in a browser: skipped.' +
      '\n  no browser — npx playwright install chromium\n',
  );
}

const DATA: ViewData = {
  suite: 'unit',
  commit: '0b5b312c9d',
  recording: 'cache/unit/record',
  tests: {
    slowestFiles: [
      { file: 'src/fast.test.ts', duration: 90 },
      { file: 'src/slow.test.ts', duration: 4200 },
      { file: 'src/mid.test.ts', duration: 700 },
    ],
    slowestCases: [],
    retried: [],
    differing: 0,
    unpassed: [],
    unpassing: 0,
    notes: [],
  },
  timeline: {
    files: [{ file: 'src/slow.test.ts', start: 1000, cost: 4200, phases: [{ name: 'cases', ms: 4000 }], cases: [] }],
    recorded: 1,
    placed: 1,
    unplaced: 0,
  },
  reach: {
    tests: [{ file: 'src/slow.test.ts', reached: ['src/world.ts'], total: 1 }],
    files: [{ file: 'src/world.ts', tests: ['src/slow.test.ts'], total: 1 }],
  },
  sources: { files: [], left: 0 },
};

// One page for the whole file, opened once and driven through its address: the
// owner's pool leases pages per painted subject, and this test paints nothing.
let root: string;
/** Counted coverage with two packages, so the filter has something to open and hide. */
const COUNTED = {
  at: '0b5b312c',
  count: { regions: 100, files: 3, run: 60, load: 10, none: 30, unjoined: 0, suites: [{ name: 'unit', kind: 'unit', run: 60, load: 10, regions: 100 }] },
  suites: [{ suite: 'unit', kind: 'unit', from: 'unit.bin', recorded: '0b5b312c' }],
  source: { seeds: 'entrypoints', files: 3, ran: 60, regions: 100, unloaded: { files: 0, lines: 0, bytes: 0, regions: 0, uncut: 0, directories: [], list: [] } },
  entries: [
    { from: 'packages/cli', own: { files: 2, ran: 40, regions: 60 }, uses: { files: 2, ran: 40, regions: 60 } },
    { from: 'packages/core', own: { files: 1, ran: 20, regions: 40 }, uses: { files: 1, ran: 20, regions: 40 } },
  ],
  ownership: [
    { file: 'packages/cli/src/a.ts', owner: 'packages/cli', regions: 40, run: 30, own: 30, others: 0, by: {}, kinds: { unit: 30 } },
    { file: 'packages/cli/src/b.ts', owner: 'packages/cli', regions: 20, run: 10, own: 10, others: 0, by: {}, kinds: { unit: 10 } },
    { file: 'packages/core/src/c.ts', owner: 'packages/core', regions: 40, run: 20, own: 20, others: 0, by: {}, kinds: { unit: 20 } },
  ],
} as unknown as Coverage;

let browser: Browser | undefined;
let page: Page | undefined;
const requests: string[] = [];

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'variance-view-browser-'));
  await writeFile(join(root, 'view.html'), viewPage(DATA));
  await writeFile(join(root, 'counted.html'), viewPage(DATA, COUNTED));
  if (BROWSER_AVAILABLE) {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('request', (request) => requests.push(request.url()));
    await page.goto(`file://${join(root, 'view.html')}`);
  }
});

afterAll(async () => {
  await browser?.close();
  await rm(root, { recursive: true, force: true });
});

const visible = (name: string): Promise<boolean> => page!.locator(`[data-view="${name}"].view`).isVisible();

describe.skipIf(!BROWSER_AVAILABLE)('variance view page in a browser', () => {
  it('opens on Tests, and an address shows another view', async () => {
    expect(await visible('tests')).toBe(true);
    expect(await visible('timeline')).toBe(false);
    await page!.evaluate(() => (location.hash = '#timeline'));
    expect(await visible('timeline')).toBe(true);
    expect(await visible('tests')).toBe(false);
  });

  it('fills the filter from the address and marks the row it names', async () => {
    await page!.evaluate(() => (location.hash = '#tests/src/mid.test.ts'));
    expect(await page!.locator('.view[data-view="tests"] tr[data-key]:not(.hidden)').count()).toBe(1);
    expect(await page!.locator('.view[data-view="tests"] tr.hit').count()).toBe(1);
  });

  it('narrows rows as the filter is typed', async () => {
    await page!.evaluate(() => (location.hash = '#tests'));
    await page!.locator('.view[data-view="tests"] .vfilter').fill('slow');
    expect(await page!.locator('.view[data-view="tests"] tr[data-key]:not(.hidden)').count()).toBe(1);
  });

  it('sorts a column by its number, ascending then descending', async () => {
    await page!.evaluate(() => (location.hash = '#tests'));
    await page!.locator('.view[data-view="tests"] .vfilter').fill('');
    const th = page!.locator('.view[data-view="tests"] th[data-sort]').nth(1);
    const first = (): Promise<string> => page!.locator('.view[data-view="tests"] tbody tr').first().getAttribute('data-key').then((key) => key ?? '');
    await th.click();
    expect(await first()).toBe('src/fast.test.ts');
    await th.click();
    expect(await first()).toBe('src/slow.test.ts');
  });

  it('opens a test file\'s pane from its row, follows a reached file to its Coverage row, and comes back', async () => {
    await page!.evaluate(() => (location.hash = '#tests'));
    await page!.locator('.view[data-view="tests"] a[href="#test/src%2Fslow.test.ts"]').first().click();
    await page!.locator('.view[data-view="test"]').waitFor();
    expect(await page!.locator('.view[data-view="test"] article.pane:not(.hidden)').count()).toBe(1);
    await page!.locator('.view[data-view="test"] a[href="#coverage/src%2Fworld.ts"]').click();
    await page!.locator('.view[data-view="coverage"]').waitFor();
    expect(await page!.locator('.view[data-view="coverage"] tr.hit').count()).toBe(1);
    await page!.locator('.view[data-view="coverage"] tr.hit a[href="#test/src%2Fslow.test.ts"]').click();
    await page!.locator('.view[data-view="test"]').waitFor();
    expect(await page!.locator('.view[data-view="test"] article.pane:not(.hidden)').count()).toBe(1);
  });

  it('shows no pane for an address that names no file', async () => {
    await page!.evaluate(() => (location.hash = '#test/src/nothing.ts'));
    expect(await page!.locator('.view[data-view="test"] article.pane:not(.hidden)').count()).toBe(0);
  });

  it('opens the package that holds a match and hides the rest, as the filter is typed in Coverage', async () => {
    const counted = await browser!.newPage({ viewport: { width: 1280, height: 800 } });
    try {
      await counted.goto(`file://${join(root, 'counted.html')}#coverage`);
      const packages = counted.locator('.view[data-view="coverage"] details.package');
      expect(await packages.count()).toBe(2);
      await counted.locator('.view[data-view="coverage"] .vfilter').fill('core/src/c');
      expect(await counted.locator('.view[data-view="coverage"] details.package:not(.hidden)').count()).toBe(1);
      expect(await counted.locator('.view[data-view="coverage"] details.package[open]').count()).toBe(1);
      expect(await counted.locator('.view[data-view="coverage"] tr[data-key]:not(.hidden)').count()).toBe(1);
      await counted.locator('.view[data-view="coverage"] .vfilter').fill('');
      expect(await counted.locator('.view[data-view="coverage"] details.package:not(.hidden)').count()).toBe(2);
      expect(await counted.locator('.view[data-view="coverage"] details.package[open]').count()).toBe(0);
    } finally {
      await counted.close();
    }
  });

  it('asked the network for nothing but its own file', () => {
    expect(requests.filter((url) => !url.startsWith('file://'))).toEqual([]);
  });
});
