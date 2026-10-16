import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { testSelectionProbes } from '@variance-authority/sense/journal';
import { collectJourneys } from '@variance-authority/sense/journey';
import { selectTestFiles } from '@variance-authority/sense/test-selection';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { routeCollector, type Plan } from './index.js';

/**
 * A page run whose server says what each page ran.
 *
 * The server here is a head: every request it serves runs inside the journey
 * its cookie names, and the account goes back to the address the other cookie
 * names. The page carries what it showed on its root. Both have to land on the
 * page they came from for a later run to photograph only what an edit reached.
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
    '\npackages/route-collector (execution): skipped, no browser — npx playwright install chromium\n',
  );
}

// Awaits between its two decisions, so two pages overlap inside it rather than
// merely following each other through it.
const SOURCE = [
  'async function later(value) {',
  '  return value;',
  '}',
  'async function currency(locale) {',
  '  if (locale === "de") {',
  '    return `${await later(1200)} euros`;',
  '  }',
  '  return `${await later(1200)} dollars`;',
  '}',
  'globalThis.__route_test_currency = currency;',
].join('\n');
const EURO_LINE = 6;
const DOLLAR_LINE = 8;

const PLAN: Plan = {
  subjects: [
    { subject: { id: 'page/euros', kind: 'route' } },
    { subject: { id: 'page/dollars', kind: 'route' } },
  ],
  notObserved: [],
  warnings: [],
};

// What this file found installed: a collector that closes puts back what it
// displaced, and the process outside these tests may still report through it.
const AMBIENT = Object.getOwnPropertyDescriptor(globalThis, '__VA__');

let root = '';
let server: Server | undefined;

beforeAll(async () => {
  root = await mkdtemp(resolve(tmpdir(), 'variance-route-execution-'));
}, 30_000);

afterAll(async () => {
  server?.closeAllConnections();
  if (server !== undefined) await new Promise<void>((settle) => server!.close(() => settle()));
  const global = globalThis as unknown as Record<string, unknown>;
  delete global['__route_test_currency'];
  if (AMBIENT === undefined) delete global['__VA__'];
  else Object.defineProperty(globalThis, '__VA__', AMBIENT);
  await rm(root, { recursive: true, force: true });
});

function diffAt(file: string, line: number): string {
  return `--- a/${file}\n+++ b/${file}\n@@ -${line},1 +${line},1 @@\n`;
}

const chromium_ = BROWSER_AVAILABLE ? describe : describe.skip;

chromium_('a page run whose server reports what each page ran', () => {
  it('selects the page that ran a changed line, and the page that showed a changed file', async () => {
    const module = resolve(root, 'currency.js');
    await writeFile(module, SOURCE, 'utf8');
    await writeFile(resolve(root, 'euros.md'), '# Euros\n', 'utf8');
    const transformed = testSelectionProbes({ root, label: 'build' }).transform.handler(SOURCE, module)!;
    const head = collectJourneys({ head: 'site', enabled: true });
    new Function(transformed.code.replace(/\n;import "[^"]+";$/, ''))();
    const currency = (globalThis as unknown as Record<string, (locale: string) => Promise<string>>)[
      '__route_test_currency'
    ]!;

    server = createServer((request, response) => {
      const path = request.url ?? '/';
      const locale = path === '/euros' ? 'de' : path === '/dollars' ? 'en' : undefined;
      if (locale === undefined) {
        response.writeHead(404).end('not found');
        return;
      }
      void head.enter(request.headers.cookie, () => currency(locale)).then((shown) => {
        const reads = locale === 'de' ? ' data-variance-reads="euros.md"' : '';
        response
          .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
          .end(`<!doctype html><html><body><main id="app"${reads}><p>${shown}</p></main></body></html>`);
      });
    });
    const port = await new Promise<number>((settle) => {
      server!.listen(0, '127.0.0.1', () => {
        const address = server!.address();
        settle(address === null || typeof address === 'string' ? 0 : address.port);
      });
    });
    const base = `http://127.0.0.1:${port}`;
    const coverageFile = resolve(root, 'coverage.bin');

    const collector = await routeCollector({
      routes: { 'page/euros': `${base}/euros`, 'page/dollars': `${base}/dollars` },
      roots: ['#app'],
      tests: { root, coverageFile, heads: ['site'] },
    })({
      config: { viewport: { width: 800, height: 600, deviceScaleFactor: 1, colorScheme: 'light' } },
      plan: PLAN,
    });
    try {
      expect((await collector.collect(PLAN.subjects[0]!)).ok).toBe(true);
      expect((await collector.collect(PLAN.subjects[1]!)).ok).toBe(true);
      await head.flush();
    } finally {
      await collector.close();
      await head.close();
    }

    expect(await selectTestFiles(coverageFile, diffAt('currency.js', EURO_LINE))).toEqual(['page/euros']);
    expect(await selectTestFiles(coverageFile, diffAt('currency.js', DOLLAR_LINE))).toEqual(['page/dollars']);
    expect(await selectTestFiles(coverageFile, diffAt('euros.md', 1))).toEqual(['page/euros']);
  }, 120_000);
});
