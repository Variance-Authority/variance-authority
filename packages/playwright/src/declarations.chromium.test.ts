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
 * different kinds of address — mapped, vendor, and served with no map — because
 * those are the three answers the call-site path gives and the engine's must be
 * the same ones. Only the first is a location; the other two are things this
 * page knows the name of and cannot place in a repository.
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

  it('maps a declaration through the module map, and drops a vendor one and an unmapped one', async () => {
    const reader = createDeclarationReader(page);
    const index = await reader.read();

    expect(index['Button']).toEqual([{ file: 'src/Button.tsx', line: 5, via: 'engine' }]);
    expect(index['Vendor']).toBeUndefined();
    // `plain.js` is a name this server made up, and only a map could say which
    // file it was cut from. Recorded anyway it would be a path in the same
    // namespace as `src/Button.tsx` that no checkout contains — and `files` is a
    // join key, so it would not fail, it would quietly match nothing.
    expect(index['Plain']).toBeUndefined();
    expect(reader.stats).toEqual({ asked: 3, located: 1 });

    // Nothing new in the page: the engine is not asked again.
    await reader.read();
    expect(reader.stats).toEqual({ asked: 3, located: 1 });

    // A component met later is asked about, and only it.
    await page.evaluate((global: string) => {
      const declared = (window as unknown as Record<string, { declared: { names: string[]; functions: Function[] } }>)[global]!
        .declared;
      declared.names.push('Later');
      declared.functions.push((window as unknown as Record<string, Function>)['Later']!);
    }, AGENT_GLOBAL);
    const grown = await reader.read();
    // Asked about — `asked` grew — and unplaceable for the same reason `Plain`
    // was, which is what an engine answer with no map is worth.
    expect(grown['Later']).toBeUndefined();
    expect(grown['Button']).toEqual(index['Button']);
    expect(reader.stats).toEqual({ asked: 4, located: 1 });

    await reader.close();
  });

  it('answers the empty index for a page whose agent holds no registry', async () => {
    const reader = createDeclarationReader(page, { global: '__nobody_here__' });
    expect(await reader.read()).toEqual({});
    expect(reader.stats).toEqual({ asked: 0, located: 0 });
    await reader.close();
  });
});
