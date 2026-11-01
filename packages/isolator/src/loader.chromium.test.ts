import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from '@playwright/test';
import { rspack, type Stats } from '@rspack/core';
import { afterAll, beforeAll, expect, it } from 'vitest';

/** A page bundled by rspack for the web, with the isolator's loader and every isolator on. */

const here = dirname(fileURLToPath(import.meta.url));
const fixture = resolve(here, '../test/fixtures/loader');

const BROWSER_AVAILABLE = ((): boolean => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

if (!BROWSER_AVAILABLE) {
  console.warn(
    '\npackages/isolator loader in a browser: skipped.' + '\n  no browser — npx playwright install chromium\n',
  );
}

/** Launched here: the lease in `@variance-authority/playwright` is published by no entry this package can import. */
let browser: Browser;
let output: string;

beforeAll(async () => {
  output = await mkdtemp(resolve(tmpdir(), 'variance-authority-isolator-'));
  if (BROWSER_AVAILABLE) browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
  await rm(output, { recursive: true, force: true });
});

const build = (): Promise<Stats> =>
  new Promise((done, fail) => {
    rspack({
      mode: 'none',
      target: 'web',
      context: fixture,
      entry: { page: './src/page.ts' },
      output: { path: output, library: { type: 'window', name: 'page' } },
      resolve: { extensions: ['.ts', '.js'] },
      module: {
        rules: [
          { test: /\.ts$/, loader: 'builtin:swc-loader', options: { jsc: { parser: { syntax: 'typescript' } } } },
          { test: /\.ts$/, enforce: 'pre', loader: resolve(here, '../dist/loader.js') },
        ],
      },
    }).run((error, stats) => (error ? fail(error) : done(stats!)));
  });

it.runIf(BROWSER_AVAILABLE)('ends in a browser what a session left, from a bundle that needs nothing of Node', async () => {
  const stats = await build();
  expect(stats.toJson({ errors: true }).errors?.map((error) => error.message)).toEqual([]);
  // One page, the one the bundle loads on: its sessions are what is under test.
  const page = await browser.newPage();
  await page.addScriptTag({ content: await readFile(resolve(output, 'page.js'), 'utf8') });
  const after = await page.evaluate(async () => {
    const { next, nextSession } = (window as unknown as { page: { next: () => number; nextSession: () => void } }).page;
    const host = window as unknown as Record<string, unknown>;
    nextSession();
    // The timers are the subject: what a session left must not fire after it.
    const counted = [next(), next()];
    let ticks = 0;
    let heard = 0;
    setInterval(() => void ticks++, 1);
    requestAnimationFrame(() => void ticks++);
    window.addEventListener('va-ping', () => void heard++);
    host.leftover = 'left';
    nextSession();
    const at = ticks;
    await new Promise((done) => setTimeout(done, 50));
    window.dispatchEvent(new Event('va-ping'));
    return { counted, again: next(), ticked: ticks - at, heard, leftover: host.leftover };
  });
  expect(after).toEqual({ counted: [1, 2], again: 1, ticked: 0, heard: 0, leftover: undefined });
});
