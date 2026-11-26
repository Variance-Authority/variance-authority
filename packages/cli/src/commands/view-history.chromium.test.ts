// compass: variance-authority.reach.crossings
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';
import { testCoverageFile } from '@variance-authority/sense/test-selection';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { cloneOf, gitPublished } from './mainline-fixture.js';
import { viewOutput } from './view-command.js';

/**
 * The History tab in a browser, drawn from the series a git share keeps: the
 * page `variance view` writes opens on it, and draws a row per kept commit.
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
    '\npackages/cli History tab in a browser: skipped.' + '\n  no browser — npx playwright install chromium\n',
  );
}

let home: string | undefined;
let browser: Browser | undefined;
let page: Page | undefined;
let first = '';

beforeAll(async () => {
  if (!BROWSER_AVAILABLE) return;
  home = await realpath(await mkdtemp(join(tmpdir(), 'va-view-history-page-')));
  const published = await gitPublished(home);
  first = published.first;
  const clone = await cloneOf(home, published.origin);
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'clone-cache'));
  const at = testCoverageFile(clone, { suite: 'unit' });
  await mkdir(dirname(at), { recursive: true });
  await writeFile(at, published.record);
  const path = (await viewOutput({ command: 'view' }, clone)).out.trim();
  // The page is a file `variance view` wrote, opened once; the harness's
  // leased pages serve story subjects, not a written file, as in view-page.
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`file://${path}#history`);
  await page.locator('body[data-opened="yes"]').waitFor();
}, 60_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await browser?.close();
  if (home !== undefined) await rm(home, { recursive: true, force: true });
});

describe.runIf(BROWSER_AVAILABLE)('the History tab in a browser', () => {
  it('draws a row per kept commit, with the files its tests reached, and each test file of the window', async () => {
    await page!.locator('nav.tabs a[href="#history"][aria-current="page"]').waitFor();
    const commits = page!.locator('section.part', { has: page!.locator('h2', { hasText: 'Commits' }) });
    await commits.locator('.row.head', { hasText: 'files reached' }).waitFor();
    expect(await commits.locator('.body .row').count()).toBe(1);
    expect(await commits.locator('.body .row').first().textContent()).toContain(first.slice(0, 7));
    const files = page!.locator('section.part', { has: page!.locator('h2', { hasText: 'Test files' }) });
    expect(await files.locator('.body .row .cell').allTextContents()).toEqual(expect.arrayContaining(['test/other.test.ts', 'test/total.test.ts']));
  });
});
