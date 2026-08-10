import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { routeCollector, type Collector } from './index.js';

/**
 * A built directory, taken as a suite.
 *
 * Percy's `percy snapshot ./build` with nothing written down, and the claim worth
 * asserting is not that files were found — it is that the pages were *served*.
 * A `file://` run half-loads an application and captures the half, which looks
 * like a page and is not one.
 */

const BROWSER_AVAILABLE = ((): boolean => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

let root = '';
let collector: Collector | undefined;

beforeAll(async () => {
  if (!BROWSER_AVAILABLE) return;

  root = mkdtempSync(join(tmpdir(), 'variance-site-'));
  mkdirSync(join(root, 'about'), { recursive: true });

  // Absolute asset paths and a same-origin fetch: both work when served and
  // neither does under `file://`, which is the whole reason a server is here.
  writeFileSync(
    join(root, 'index.html'),
    '<!doctype html><html><body><main id="app"><h1>Home</h1></main></body></html>',
  );
  writeFileSync(
    join(root, 'about', 'index.html'),
    '<!doctype html><html><body><main id="app"><h1>About</h1></main></body></html>',
  );

  collector = await routeCollector({ directory: root, roots: ['#app'] })({
    config: { viewport: { width: 800, height: 600, deviceScaleFactor: 1, colorScheme: 'light' } },
  });
}, 120_000);

afterAll(async () => {
  await collector?.close();
  if (root !== '') rmSync(root, { recursive: true, force: true });
});

const chromium_ = BROWSER_AVAILABLE ? describe : describe.skip;

if (!BROWSER_AVAILABLE) {
  console.warn(
    '\npackages/route-collector (directory): skipped.' +
      '\n  no browser — npx playwright install chromium\n',
  );
}

chromium_('a built directory as a suite', () => {
  it('plans a subject per page, addressed as the site will be', async () => {
    // `about/index.html` is the page at `about/`, which is the URL a visitor
    // gets and therefore the id a baseline belongs under. Keyed on the file
    // name, the baseline would be for a page nobody visits.
    const plan = await collector!.plan();

    expect(plan.subjects.map((planned) => planned.subject.id).sort()).toEqual(['/', 'about']);
    // The trade is stated in the plan itself, because a discovered suite can
    // quietly stop watching a page that the build stopped producing.
    expect(plan.warnings.join(' ')).toContain('stops being watched');
  }, 120_000);

  it('serves them, rather than opening them off the disk', async () => {
    const plan = await collector!.plan();
    const home = plan.subjects.find((planned) => planned.subject.id === '/');

    const collected = await collector!.collect(home!);

    expect(collected.ok).toBe(true);
    if (!collected.ok) return;
    expect(collected.document.html).toContain('Home');
  }, 120_000);

  it('refuses a directory with no page in it', async () => {
    // Zero subjects and exit 0 is indistinguishable from a suite that passed.
    const empty = mkdtempSync(join(tmpdir(), 'variance-empty-'));
    const bare = await routeCollector({ directory: empty, roots: ['#app'] })({
      config: { viewport: { width: 800, height: 600, deviceScaleFactor: 1, colorScheme: 'light' } },
    });

    await expect(bare.plan()).rejects.toThrow(/no \.html file/);
    await bare.close();
    rmSync(empty, { recursive: true, force: true });
  }, 120_000);
});
