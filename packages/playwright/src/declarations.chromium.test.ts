import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AGENT_GLOBAL } from './agent.js';
import { createDeclarationReader } from './declarations.js';

/**
 * The engine asked where a function was declared, through the real protocol.
 *
 * Nothing here can be asserted without Chromium: `[[FunctionLocation]]` is a
 * V8 internal property, and the only interesting failure is a real browser
 * answering a coordinate this reader turns into the wrong file. So the page is
 * real, the source map is real, and the three functions are declared at three
 * different kinds of address — mapped, vendor, and served as written — because
 * those are the three answers the call-site path gives and the engine's must be
 * the same ones.
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
    '\npackages/playwright (declarations): skipped.' +
      '\n  no browser — npx playwright install chromium\n',
  );
}

/** Generated line 1, column 0 → `src/Button.tsx` line 5 (`AAIA`: +0, source 0, +4 lines, +0). */
const MAP = Buffer.from(
  JSON.stringify({ version: 3, sources: ['src/Button.tsx'], names: [], mappings: 'AAIA;' }),
).toString('base64');

const APP = [
  'function Button() { return null; }',
  `window[${JSON.stringify(AGENT_GLOBAL)}] = {`,
  "  capture() { return '{}'; },",
  "  declared: { id: 't1', names: ['Button', 'Vendor', 'Plain'], functions: [Button, Vendor, Plain] },",
  '};',
  `//# sourceMappingURL=data:application/json;base64,${MAP}`,
].join('\n');

const VENDOR = 'function Vendor() { return null; }';

const PLAIN = ['// served as written, no map', '', 'function Plain() { return null; }', '', 'function Later() { return null; }'].join(
  '\n',
);

const HTML =
  '<!doctype html><script src="/node_modules/lib/index.js"></script>' +
  '<script src="/plain.js"></script><script src="/app.js"></script><main></main>';

describe.skipIf(!BROWSER_AVAILABLE)('the declaration reader', () => {
  let server: Server;
  let origin: string;
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    server = createServer((request, response) => {
      const body =
        request.url === '/app.js'
          ? APP
          : request.url === '/plain.js'
            ? PLAIN
            : request.url === '/node_modules/lib/index.js'
              ? VENDOR
              : HTML;
      const type = request.url?.endsWith('.js') ? 'text/javascript' : 'text/html';
      response.writeHead(200, { 'content-type': type });
      response.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch();
    page = await browser.newPage();
    await page.goto(`${origin}/`);
  });

  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('maps a declaration through the module map, drops a vendor one, keeps a plain one', async () => {
    const reader = createDeclarationReader(page);
    const index = await reader.read();

    expect(index['Button']).toEqual([{ file: 'src/Button.tsx', line: 5, via: 'engine' }]);
    expect(index['Vendor']).toBeUndefined();
    // Served from the dev server's own origin and kept as a repository-relative
    // path. The port a harness happened to bind is a coordinate, not a file: it
    // differs on every run, so a name carrying it joins to nothing later.
    expect(index['Plain']).toEqual([{ file: 'plain.js', line: 3, via: 'engine' }]);
    expect(reader.stats).toEqual({ asked: 3, located: 2 });

    // Nothing new in the page: the engine is not asked again.
    await reader.read();
    expect(reader.stats).toEqual({ asked: 3, located: 2 });

    // A component met later is asked about, and only it.
    await page.evaluate((global: string) => {
      const declared = (window as unknown as Record<string, { declared: { names: string[]; functions: Function[] } }>)[global]!
        .declared;
      declared.names.push('Later');
      declared.functions.push((window as unknown as Record<string, Function>)['Later']!);
    }, AGENT_GLOBAL);
    const grown = await reader.read();
    expect(grown['Later']).toEqual([{ file: 'plain.js', line: 5, via: 'engine' }]);
    expect(grown['Button']).toEqual(index['Button']);
    expect(reader.stats).toEqual({ asked: 4, located: 3 });

    await reader.close();
  });

  it('answers the empty index for a page whose agent holds no registry', async () => {
    const reader = createDeclarationReader(page, { global: '__nobody_here__' });
    expect(await reader.read()).toEqual({});
    expect(reader.stats).toEqual({ asked: 0, located: 0 });
    await reader.close();
  });
});
