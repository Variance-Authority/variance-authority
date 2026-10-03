import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from '@playwright/test';
import { testSelectionProbes } from '@variance-authority/sense/journal';
import { decodeExecutionIndex, type ExecutionIndex } from '@variance-authority/sense/test-selection';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// A real Playwright run over a spec that says what its cases arranged, from the
// body and from hooks, recorded through `varianceFixtures` the way a suite
// records — the page hands over a crossing, as an instrumented build's would.

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../..');
const fixture = resolve(here, '../test/fixtures/preconditions');
const spec = `${relative(repository, fixture)}/tests/checkout.spec.ts`;

const BROWSER_AVAILABLE = ((): boolean => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

if (!BROWSER_AVAILABLE) {
  console.warn(
    '\npackages/playwright-test preconditions: skipped.' +
      '\n  no browser — npx playwright install chromium\n',
  );
}

describe.runIf(BROWSER_AVAILABLE)('a Playwright case that names its preconditions', () => {
  let directory: string;
  let index: ExecutionIndex;
  let output: string;
  let source: readonly string[];

  beforeAll(async () => {
    directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-preconditions-playwright-'));
    const cacheRoot = resolve(directory, 'cache');
    const coverageFile = resolve(directory, 'coverage.bin');
    const cart = resolve(fixture, 'src/cart.ts');
    testSelectionProbes({ root: repository, cacheRoot }).transform(await readFile(cart, 'utf8'), cart);
    output = await execute(
      process.execPath,
      [resolve(repository, 'node_modules/@playwright/test/cli.js'), 'test', '--config', resolve(fixture, 'playwright.config.mjs')],
      {
        cwd: fixture,
        env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, VARIANCE_AUTHORITY_CACHE: cacheRoot },
      },
    ).then(({ stdout, stderr }) => `${stdout}${stderr}`);
    index = decodeExecutionIndex(await readFile(coverageFile));
    source = (await readFile(resolve(fixture, 'tests/checkout.spec.ts'), 'utf8')).split('\n');
  }, 120_000);

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const line = (call: string): number => source.findIndex((text) => text.endsWith(`// ${call}`)) + 1;
  const said = (name: string, value: string | number | boolean, call: string) =>
    ({ name, value, site: `${spec}:${line(call)}`, level: call === 'mocked each' ? 1 : 0xffff });
  const row = (...path: readonly string[]) => {
    const name = path.join(' > ');
    const found = index.tests.find((test) => test.name === name);
    expect(found, `${name} among ${index.tests.map((test) => test.name).join(', ')}`).toBeDefined();
    return found!;
  };

  it('carries what its body said, with the call site, over what a beforeEach said', () => {
    expect(row('mocked', 'refunds behind a flag').preconditions).toEqual([
      said('flag', 'ff-on', 'case flag'),
      said('network', 'mocked', 'mocked each'),
    ]);
    expect(row('live', 'replays a recording').preconditions).toEqual([said('network', 'recorded', 'case network')]);
  });

  it('carries what a beforeEach inside a describe said, which a sibling describe never hears', () => {
    expect(row('mocked', 'pays').preconditions).toEqual([said('network', 'mocked', 'mocked each')]);
    expect(row('live', 'replays a recording').preconditions?.some((held) => held.value === 'mocked')).toBe(false);
  });

  it('keeps two values said at one level as a contradiction', () => {
    expect(row('contradicted').preconditions).toEqual([
      said('flag', 'ff-off', 'contradicted off'),
      said('flag', 'ff-on', 'contradicted on'),
    ]);
  });

  it('gives a case that said something a row, and a case that said nothing an empty one', () => {
    expect(row('crosses nothing').preconditions).toEqual([said('seeded', true, 'seeded')]);
    expect(row('says nothing').preconditions).toEqual([]);
  });

  it('reports a call in afterEach with its site and lays it on no case', () => {
    expect(output).toMatch(new RegExp(`variancePrecondition at \\S*checkout\\.spec\\.ts:${line('after each')} ran after its case`));
    expect(index.tests.flatMap((test) => test.preconditions ?? []).some((held) => held.name === 'cleaned')).toBe(false);
  });

  it.todo('lets a beforeEach inside a describe override one at the top of the file — needs the depth of the describe that declared the hook, which Playwright does not publish; every beforeEach reads at the case\'s innermost describe, so the two are a contradiction');

  it.todo('throws for a call at the top level or in a describe callback of the first file a worker loads — needs the listener installed before the worker fixture, which Playwright sets up after the file is collected');
});
