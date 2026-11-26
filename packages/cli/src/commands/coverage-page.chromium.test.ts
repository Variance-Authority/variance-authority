// compass: variance-authority.reach.crossings
import { existsSync } from 'node:fs';
import { chromium, type Browser, type Page } from '@playwright/test';
import type { SuiteChange } from '@variance-authority/sense/test-selection';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatCoverage } from './coverage-text.js';
import type { CoverageSource } from './coverage-source.js';
import type { Coverage } from './coverage.js';

/**
 * The coverage page on a phone: the link at the end of a pull request's comment
 * is opened there as often as on a desktop, so the page fits a 390 px screen.
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
    '\npackages/cli coverage page in a browser: skipped.' + '\n  no browser — npx playwright install chromium\n',
  );
}

const LONG = 'packages/cli/src/commands/a-file-with-a-name-long-enough-to-overflow-a-phone.ts';
const region = (name: string, startLine: number) => ({ file: LONG, kind: 'function', name, startLine, endLine: startLine + 3 });
const CHANGE: SuiteChange = {
  gained: 406, lost: 50, hidden: 0, unmeasured: 0, thinned: 3,
  written: { regions: 0, run: 0 }, deleted: { regions: 0, run: 0 },
  arrived: { regions: 0, run: 0, files: [] }, departed: { regions: 0, run: 0, files: [], ran: [] },
  testFiles: [{ file: 'packages/cli/src/side-job.chromium.test.ts', entered: [region('one', 1)], left: [region('two', 9)] }],
  files: [{ file: LONG, started: 406, stopped: 50 }],
};
const own = (regions: number, ran: number) => ({ seeds: 'entrypoints', files: 4, ran, regions }) as unknown as CoverageSource;
const ANSWER: Coverage = {
  at: '0e3b0415e286dc96',
  count: {
    regions: 120_000, files: 900, run: 108_000, load: 4_000, none: 8_000, unjoined: 0,
    suites: [{ name: 'unit', kind: 'unit', run: 106_000, load: 3_000, regions: 118_000 }, { name: 'chromium', kind: 'e2e', run: 30_000, load: 1_000, regions: 60_000 }],
    overlap: { several: 20_000, alone: { unit: 80_000, e2e: 8_000 } },
  },
  base: {
    regions: 119_000, files: 899, run: 107_500, load: 4_000, none: 7_500, unjoined: 0,
    suites: [{ name: 'unit', kind: 'unit', run: 105_600, load: 3_000, regions: 117_000 }, { name: 'chromium', kind: 'e2e', run: 29_700, load: 1_000, regions: 59_000 }],
  },
  suites: [
    { suite: 'unit', kind: 'unit', from: 'unit.bin', base: { from: 'base.bin', commit: 'e286dc96aa', change: CHANGE } },
    { suite: 'chromium', kind: 'e2e', from: 'chromium.bin', base: { from: 'base.bin', commit: 'e286dc96aa', change: CHANGE } },
  ],
  source: {
    ...own(130_000, 108_000), files: 1_000,
    unloaded: { files: 8, lines: 900, bytes: 30_000, regions: 370, uncut: 0, directories: [{ directory: 'packages/sense/src/test-selection/', files: 8, lines: 900, regions: 370 }], list: [] },
  } as CoverageSource,
  entries: [{ from: 'packages/cli', own: own(40_000, 36_000), uses: own(60_000, 50_000) }],
  ownership: [{ file: LONG, owner: 'packages/cli', regions: 40, run: 30, own: 25, others: 5, by: { 'packages/core': 5 }, kinds: { unit: 25 } }],
  fanIn: {
    kinds: [{ kind: 'unit', testFiles: 1_271, regions: 106_000, one: 9_000, median: 2, p90: 9, max: 400 }],
    files: [{ file: LONG, regions: 40, run: 30, one: 6, entered: 14, by: { unit: 12, e2e: 2 }, peak: 9, median: 3, testFiles: 1_271, share: 0.1, duration: 0.08 }],
  },
};

let browser: Browser | undefined;
let page: Page | undefined;

beforeAll(async () => {
  if (!BROWSER_AVAILABLE) return;
  // One browser and one page: the page is the subject, and it is loaded once.
  // `@variance-authority/playwright` does not publish its browser lease.
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.setContent(formatCoverage(ANSWER, 'html'));
  // Open every fold, so what a tap shows is measured too.
  await page.evaluate(() => { for (const box of document.querySelectorAll('details')) box.open = true; });
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

describe.skipIf(!BROWSER_AVAILABLE)('the coverage page at 390 × 844', () => {
  it('scrolls only down, never sideways', async () => {
    expect(await page!.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  it('lets its header scroll away', async () => {
    await page!.evaluate(() => window.scrollTo(0, 2_000));
    expect(await page!.evaluate(() => document.querySelector('header')!.getBoundingClientRect().bottom)).toBeLessThanOrEqual(0);
  });

  it('stacks a suite of the change in two columns, its counts allowed to wrap', async () => {
    const [columns, wrap] = await page!.evaluate(() => {
      const row = document.querySelector('.suites .suite')!;
      return [getComputedStyle(row).gridTemplateColumns.split(' ').length, getComputedStyle(row.querySelector('.moves')!).whiteSpace];
    });
    expect(columns).toBe(2);
    expect(wrap).toBe('normal');
  });

  it('names the column of every stacked count', async () => {
    const unlabelled = await page!.evaluate(() =>
      [...document.querySelectorAll('td.num')]
        .filter((cell) => cell.getClientRects().length > 0 && cell.textContent!.trim() !== '')
        .filter((cell) => !/^"[a-z]/u.test(getComputedStyle(cell, '::before').content))
        .map((cell) => cell.closest('tr')?.getAttribute('data-row') ?? '?'),
    );
    expect(unlabelled).toEqual([]);
  });

  it('draws no visible text under 12 px', async () => {
    const small = await page!.evaluate(() => {
      const found: string[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const element = node.parentElement!;
        if (node.textContent!.trim() === '' || element.getClientRects().length === 0) continue;
        const size = Number.parseFloat(getComputedStyle(element).fontSize);
        if (size < 12) found.push(`${size}px ${node.textContent!.trim().slice(0, 30)}`);
      }
      return found;
    });
    expect(small).toEqual([]);
  });
});
