// compass: variance-authority.reach.crossings
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';
import { encodeTestCoverage, testCoverageFile } from '@variance-authority/sense/test-selection';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { viewOutput } from './view-command.js';

/**
 * The page `variance view` writes, opened from its file in a browser: it
 * decodes the record it carries, the tabs route by address, the filter narrows
 * a table, a header sorts it, a row opens what it names, and the page asks the
 * network for nothing.
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
    '\npackages/cli view page in a browser: skipped.' + '\n  no browser — npx playwright install chromium\n',
  );
}

const TESTS = [
  { file: 'src/fast.test.ts', duration: 90 },
  { file: 'src/slow.test.ts', duration: 4200 },
  { file: 'src/mid.test.ts', duration: 700 },
];

const COVERAGE = {
  version: 3,
  instrumentation: 'fixture',
  tests: TESTS.map(({ file, duration }) => ({ file, duration, complete: true, preconditions: [] })),
  modules: [
    {
      file: 'src/world.ts',
      sourceDigest: 'd',
      instrumented: true,
      blocks: [{ ordinal: 0, kind: 'module' as const, digest: 'b', name: '', path: '', startLine: 1, endLine: 1, source: true, testFiles: ['src/slow.test.ts'] }],
    },
  ],
};

let browser: Browser | undefined;
let page: Page | undefined;
const requests: string[] = [];

/** The first cell of each row drawn in the page's first table. */
const firstCells = (): Promise<string[]> => page!.locator('section.part').first().locator('.body .row .cell:first-child').allTextContents();
const go = async (hash: string): Promise<void> => {
  await page!.evaluate((to) => (location.hash = to), hash);
};

beforeAll(async () => {
  if (!BROWSER_AVAILABLE) return;
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-view-page-cache-')));
  const root = mkdtempSync(join(tmpdir(), 'va-view-page-'));
  execFileSync('git', ['init', '--quiet', root]);
  const at = testCoverageFile(root, {});
  mkdirSync(dirname(at), { recursive: true });
  writeFileSync(at, Buffer.from(encodeTestCoverage(COVERAGE)));
  const path = viewOutput({ command: 'view' }, root).out.trim();
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('request', (request) => requests.push(request.url()));
  await page.goto(`file://${path}`);
  await page.locator('body[data-opened="yes"]').waitFor();
}, 60_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await browser?.close();
});

describe.runIf(BROWSER_AVAILABLE)('the view page in a browser', () => {
  it('opens on the overview, counting what the record holds', async () => {
    expect(await page!.locator('nav.tabs a[aria-current="page"]').textContent()).toBe('Overview');
    const facts = await page!.locator('dl.facts').textContent();
    expect(facts).toContain('test files3');
    expect(facts).toContain('modules1');
  });

  it('routes a tab by its address', async () => {
    await go('#files');
    await page!.locator('nav.tabs a[href="#files"][aria-current="page"]').waitFor();
    // In the record's order, which is by path.
    expect(await firstCells()).toEqual(['src/fast.test.ts', 'src/mid.test.ts', 'src/slow.test.ts']);
  });

  it('narrows the rows as the filter is typed', async () => {
    await go('#files');
    await page!.locator('input.vfilter').fill('slow');
    await page!.locator('section.part h2 .count', { hasText: '1 of 3' }).waitFor();
    expect(await firstCells()).toEqual(['src/slow.test.ts']);
    await page!.locator('input.vfilter').fill('');
    await page!.locator('section.part h2 .count', { hasText: /^3$/u }).waitFor();
  });

  it('sorts a number column slowest first, then fastest first', async () => {
    await go('#files');
    const took = page!.locator('.row.head button.col', { hasText: /^took$/u });
    await took.click();
    expect(await firstCells()).toEqual(['src/slow.test.ts', 'src/mid.test.ts', 'src/fast.test.ts']);
    await took.click();
    expect(await firstCells()).toEqual(['src/fast.test.ts', 'src/mid.test.ts', 'src/slow.test.ts']);
  });

  it('opens a test file from its row, and follows what it entered to the module', async () => {
    await go('#files');
    await page!.locator('a.go', { hasText: 'src/slow.test.ts' }).click();
    await page!.locator('h1.title', { hasText: 'src/slow.test.ts' }).waitFor();
    expect(page!.url()).toMatch(/#test\/src%2Fslow\.test\.ts$/u);
    await page!.locator('a.go', { hasText: 'src/world.ts' }).first().click();
    await page!.locator('h1.title', { hasText: 'src/world.ts' }).waitFor();
  });

  it('says so for an address that names nothing in the record', async () => {
    await go('#test/src%2Fnothing.ts');
    await page!.locator('main p.empty', { hasText: 'The record holds nothing at test/' }).waitFor();
  });

  it('asked the network for nothing but its own file', () => {
    expect(requests.filter((url) => !url.startsWith('file://'))).toEqual([]);
  });
});
