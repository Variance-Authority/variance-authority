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

// A real Playwright run over a spec whose modifiers say a precondition. A
// modifier decides whether its case runs, so it arranges nothing for it: the
// run fails those cases, which is why this fixture is apart from the one in
// `preconditions.chromium.test.ts`.

const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../..');
const fixture = resolve(here, '../test/fixtures/precondition-modifiers');
const spec = `${relative(repository, fixture)}/tests/modifiers.spec.ts`;

const BROWSER_AVAILABLE = ((): boolean => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

if (!BROWSER_AVAILABLE) {
  console.warn(
    '\npackages/playwright-test precondition modifiers: skipped.' +
      '\n  no browser — npx playwright install chromium\n',
  );
}

describe.runIf(BROWSER_AVAILABLE)('a Playwright modifier that names a precondition', () => {
  let directory: string;
  let index: ExecutionIndex;
  let output: string;
  let source: readonly string[];

  beforeAll(async () => {
    directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-precondition-modifiers-'));
    const cacheRoot = resolve(directory, 'cache');
    const coverageFile = resolve(directory, 'coverage.bin');
    const plan = resolve(fixture, 'src/plan.ts');
    testSelectionProbes({ root: repository, cacheRoot }).transform(await readFile(plan, 'utf8'), plan);
    output = await execute(
      process.execPath,
      [resolve(repository, 'node_modules/@playwright/test/cli.js'), 'test', '--config', resolve(fixture, 'playwright.config.mjs')],
      {
        cwd: fixture,
        env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, VARIANCE_AUTHORITY_CACHE: cacheRoot },
      },
    ).then(
      ({ stdout, stderr }) => `${stdout}${stderr}`,
      (error: { stdout?: string; stderr?: string }) => `${error.stdout ?? ''}${error.stderr ?? ''}`,
    );
    index = decodeExecutionIndex(await readFile(coverageFile));
    source = (await readFile(resolve(fixture, 'tests/modifiers.spec.ts'), 'utf8')).split('\n');
  }, 120_000);

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const line = (call: string): number => source.findIndex((text) => text.endsWith(`// ${call}`)) + 1;
  const heldNames = () => index.tests.flatMap((test) => test.preconditions ?? []).map((held) => held.name);

  it('throws for a call in a modifier that reads a test fixture, naming its site, and lays it on no case', () => {
    expect(heldNames()).not.toContain('viewport');
    expect(output).toMatch(new RegExp(`variancePrecondition at \\S*modifiers\\.spec\\.ts:${line('skip modifier')} ran in a test\\.skip modifier`));
  });

  it('throws for a call in a modifier that reads only worker fixtures, naming its site, and lays it on no case', () => {
    expect(heldNames()).not.toContain('engine');
    expect(output).toMatch(new RegExp(`variancePrecondition at \\S*modifiers\\.spec\\.ts:${line('slow modifier')} ran in a test\\.slow modifier`));
  });

  it('still lays a call in the body on its case', () => {
    const body = index.tests.find((test) => test.name === 'says it in its body');
    expect(body?.preconditions).toEqual([{ name: 'seeded', value: true, site: `${spec}:${line('body')}`, level: 0xffff }]);
  });

  it('throws for a call in a worker fixture a per-case modifier asked for first, and lays it on no case', () => {
    expect(heldNames()).not.toContain('stock');
    expect(output).toMatch(new RegExp(`variancePrecondition at \\S*modifiers\\.spec\\.ts:${line('worker fixture')} ran in a worker fixture`));
  });

  it('lays a call in a test fixture a modifier asked for first on the case it was set up for', () => {
    const asked = index.tests.find((test) => test.name === 'skipped by a fixture > runs past a fixture skip');
    expect(asked?.preconditions).toEqual([{ name: 'cart', value: 'filled', site: `${spec}:${line('fixture')}`, level: 0xffff }]);
  });
});
