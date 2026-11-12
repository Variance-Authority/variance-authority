import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';
import { executionCollectorSource, testSelectionProbes } from '@variance-authority/sense/journal';
import { collectJourneys } from '@variance-authority/sense/journey';
import { attachVantage, type AttachedVantage } from '@variance-authority/vantage/attach';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../bin.fixture.js';
import { main } from '../bin.js';

/**
 * An application used by hand in a browser, with `reportPage` mounted: the
 * published module as an application resolves it, served to a real page beside
 * a server head, both reporting to one watcher that `ask ran` then reads.
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
    '\npackages/cli a page that reports itself: skipped.' +
      '\n  no browser — npx playwright install chromium\n',
  );
}

const require = createRequire(import.meta.url);
/** The export, where `@variance-authority/sense/page` resolves for an application. */
const MOUNTED = require.resolve('@variance-authority/sense/page');
const WIRE = createRequire(MOUNTED).resolve('@variance-authority/wire');

const PAGE_SOURCE = [
  'function render(text) {',
  "  document.querySelector('#out').textContent = text;",
  '}',
  'globalThis.__shop_ask = async function ask() {',
  "  render(await (await fetch('/quote')).text());",
  '};',
  'globalThis.__shop_pick = function pick() {',
  "  render('picked');",
  '};',
  "document.addEventListener('DOMContentLoaded', () => render('ready'));",
].join('\n');

const SERVER_SOURCE = [
  'globalThis.__pricing_quote = function quote() {',
  "  return 'quote: 42';",
  '};',
  'globalThis.__pricing_checkout = function checkout() {',
  "  return 'checked out';",
  '};',
].join('\n');

/** How many modules the wide page loads, and how many functions each runs: a page of a few hundred modules. */
const WIDE = 400;
const DEEP = 30;

/** One module of the wide page: half its functions run as it loads, half once the page is ready. */
function wideSource(module: number): string {
  const names = Array.from({ length: DEEP }, (_, index) => `wide${module}_${index}`);
  return [
    ...names.map((name, index) => `function ${name}(value) {\n  return value + ${index};\n}`),
    `for (const run of [${names.slice(0, DEEP / 2).join(', ')}]) run(1);`,
    `document.addEventListener('DOMContentLoaded', () => { for (const run of [${names.slice(DEEP / 2).join(', ')}]) run(1); });`,
  ].join('\n');
}

/** Probed as a build probes it, less the collector import a bundler would resolve. */
function probed(root: string, name: string, source: string): string {
  const transformed = testSelectionProbes({ root, label: 'build' }).transform.handler(source, join(root, name))!;
  return transformed.code.replace(/\n;import "[^"]+";$/, '');
}

// What this file found installed: a head that closes puts it back, and the run outside this file still reports through it.
const AMBIENT = Object.getOwnPropertyDescriptor(globalThis, '__VA__');
const cwd = process.cwd();

let root = '';
let vantage: AttachedVantage | undefined;
let head: ReturnType<typeof collectJourneys> | undefined;
let server: Server | undefined;
let browser: Browser | undefined;
let page: Page | undefined;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'variance-ran-page-'));
});

afterAll(async () => {
  process.chdir(cwd);
  await browser?.close();
  server?.closeAllConnections();
  if (server !== undefined) await new Promise<void>((settle) => server!.close(() => settle()));
  await head?.close();
  await vantage?.close();
  const global = globalThis as unknown as Record<string, unknown>;
  delete global['__pricing_quote'];
  delete global['__pricing_checkout'];
  if (AMBIENT === undefined) delete global['__VA__'];
  else Object.defineProperty(globalThis, '__VA__', AMBIENT);
  await rm(root, { recursive: true, force: true });
});

const chromium_ = BROWSER_AVAILABLE ? describe : describe.skip;

chromium_('a page with `reportPage` mounted, used by hand', () => {
  it('lists each load, click and submit as one execution, with the page\'s head beside the server\'s', async () => {
    vantage = await attachVantage();
    const watcher = vantage.address;
    await writeFile(join(root, 'shop.js'), PAGE_SOURCE, 'utf8');
    await writeFile(join(root, 'pricing.js'), SERVER_SOURCE, 'utf8');
    head = collectJourneys({ head: 'pricing', enabled: true, watcher });
    new Function(probed(root, 'pricing.js', SERVER_SOURCE))();
    const served = globalThis as unknown as Record<string, () => string>;

    const mounted =
      '<script type="importmap">{"imports":{"@variance-authority/wire":"/wire.js","@variance-authority/sense/page":"/sense/' +
      `${basename(MOUNTED)}"}}</script>` +
      `<script>${executionCollectorSource()}</script>` +
      '<script type="module">import { reportPage } from "@variance-authority/sense/page";' +
      `reportPage(${JSON.stringify(watcher)});</script>`;
    const shop =
      `<!doctype html><html><head>${mounted}<script>${probed(root, 'shop.js', PAGE_SOURCE)}</script>` +
      // An application's own handler on the window, in the capture phase, registered once the page reports.
      "<script>document.addEventListener('DOMContentLoaded', () => window.addEventListener('click', (event) => {" +
      " if (event.target.id === 'early') __shop_ask(); }, true));</script></head><body>" +
      '<button id="early">early</button>' +
      '<button id="ask" onclick="__shop_ask()">ask</button>' +
      '<form id="order" onsubmit="event.preventDefault(); __shop_ask()"><button id="buy" onclick="__shop_pick()">buy</button></form>' +
      '<a id="next" href="/next" onclick="__shop_pick()">next</a> <a id="wide" href="/wide">wide</a>' +
      '<p id="out"></p></body></html>';
    await mkdir(join(root, 'wide'));
    const modules = Array.from({ length: WIDE }, (_, module) => [`wide/module-${module}.js`, wideSource(module)] as const);
    await Promise.all(modules.map(([name, source]) => writeFile(join(root, name), source, 'utf8')));
    const wide =
      `<!doctype html><html><head>${mounted}` +
      // Each in a scope of its own, as a module has: a probed file declares what it reports through.
      modules.map(([name, source]) => `<script>(() => {${probed(root, name, source)}\n})();</script>`).join('') +
      '</head><body><a id="away" href="/plain">away</a></body></html>';
    const pages: Record<string, string> = { '/': shop, '/wide': wide, '/plain': '<!doctype html><title>plain</title>' };

    /** The execution each request to a handler arrived under, in the order they arrived. */
    const asked: string[] = [];
    const script = async (file: string): Promise<[string, string]> => ['text/javascript', await readFile(file, 'utf8')];
    server = createServer((request, response) => {
      const path = request.url ?? '/';
      const handler = path === '/quote' ? served['__pricing_quote']! : path === '/next' ? served['__pricing_checkout']! : undefined;
      if (handler !== undefined) {
        asked.push(/variance-authority-journey=([^;]+)/.exec(request.headers.cookie ?? '')?.[1] ?? '');
        const said = head!.enter(request.headers.cookie, handler);
        if (path === '/quote') response.writeHead(200, { 'content-type': 'text/plain' }).end(said);
        else response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(shop);
      } else if (pages[path] !== undefined) {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(pages[path]);
      } else if (path === '/wire.js' || /^\/sense\/[\w-]+\.js$/.test(path)) {
        void script(path === '/wire.js' ? WIRE : join(dirname(MOUNTED), basename(path))).then(([type, body]) =>
          response.writeHead(200, { 'content-type': type }).end(body),
        );
      } else {
        response.writeHead(404).end('not found');
      }
    });
    const port = await new Promise<number>((settle) => {
      server!.listen(0, '127.0.0.1', () => {
        const address = server!.address();
        settle(address === null || typeof address === 'string' ? 0 : address.port);
      });
    });

    // One browser and one page: the page is the subject, and it is loaded once. Every other document is reached by a link.
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    /** What the page sent the watcher, and how: a beacon is a `ping`. */
    const sends: { kind: string; bytes: number }[] = [];
    page.on('request', (request) => {
      if (request.url().startsWith(watcher)) sends.push({ kind: request.resourceType(), bytes: (request.postData() ?? '').length });
    });
    const journeyOf = async (): Promise<string> =>
      /variance-authority-journey=([^;]+)/.exec(await page!.evaluate(() => document.cookie))?.[1] ?? '';
    const ran = async () => {
      await head!.flush();
      return vantage!.observatory.snapshot().ran;
    };
    const heads = async (id: string): Promise<string[]> =>
      ((await ran()).executions.find((one) => one.id === id)?.heads ?? []).map((one) => one.head).sort();
    const arrived = async (count: number): Promise<string> => {
      await expect.poll(() => asked.length).toBe(count);
      return asked[count - 1]!;
    };

    await page.goto(`http://127.0.0.1:${port}/`);
    await expect.poll(journeyOf).not.toBe('');
    const load = await journeyOf();
    await expect.poll(() => heads(load)).toEqual(['page']);

    await page.click('#ask');
    const click = await arrived(1);
    expect(click).not.toBe(load);
    await expect.poll(() => page!.textContent('#out')).toBe('quote: 42');
    await expect.poll(() => heads(click)).toEqual(['page', 'pricing']);

    process.chdir(root);
    let out = '';
    await main(['ask', 'ran', '--at', watcher], { out: (text) => { out += text; }, err: () => {} });
    // The click's own block, and nothing listed after it.
    const listed = out.slice(out.indexOf(click)).split('\n\n')[0]!;
    expect(listed).toContain('head page');
    expect(listed).toContain('head pricing');

    // A submit button is a click and the submit it causes: one thing done, so one execution.
    await page.click('#buy');
    const buy = await arrived(2);
    await expect.poll(() => heads(buy)).toEqual(['page', 'pricing']);
    expect((await ran()).executions.map((one) => one.id).sort()).toEqual([load, click, buy].sort());

    // A submit no click caused, as Enter in a field is where there is no button, names its own.
    await page.evaluate(() => document.querySelector<HTMLFormElement>('#order')!.requestSubmit());
    const submit = await arrived(3);
    expect([load, click, buy]).not.toContain(submit);
    await expect.poll(() => heads(submit)).toEqual(['page', 'pricing']);

    // A handler the application put on the window runs for the click it handles, not for the one before.
    await page.click('#early');
    const early = await arrived(4);
    expect([load, click, buy, submit]).not.toContain(early);
    await expect.poll(() => heads(early)).toEqual(['page', 'pricing']);

    // A link that runs page code and then leaves: what the page ran for that click is the click's, not the next document's.
    await page.click('#next');
    await page.waitForURL('**/next');
    const next = await arrived(5);
    expect([load, click, buy, submit, early]).not.toContain(next);
    await expect.poll(() => heads(next)).toEqual(['page', 'pricing']);

    // A page of a few hundred modules reports all of them, however much one account weighs.
    await page.click('#wide');
    await page.waitForURL('**/wide');
    await expect.poll(journeyOf).not.toBe('');
    const wideLoad = await journeyOf();
    /** How many of the wide page's modules are listed under its load, and how many as run while they loaded. */
    const reportedWide = async (): Promise<[number, number]> => {
      const { executions, common } = await ran();
      const count = (heads: readonly { modules: readonly { id: string }[] }[]): number =>
        new Set(heads.flatMap((one) => one.modules.map((module) => module.id)).filter((id) => id.startsWith('wide/'))).size;
      return [count(executions.find((one) => one.id === wideLoad)?.heads ?? []), count(common)];
    };
    await expect.poll(reportedWide).toEqual([WIDE, WIDE]);
    // The account of that load is more than a browser lets a beacon carry, or this showed nothing.
    expect(sends.filter((one) => one.kind === 'fetch').map((one) => one.bytes > 64 * 1024)).toEqual([true]);

    // Left for a page that does not report, nothing of this one stays behind to be sent with that page's requests.
    await page.click('#away');
    await page.waitForURL('**/plain');
    expect(await journeyOf()).toBe('');
  }, 120_000);
});
