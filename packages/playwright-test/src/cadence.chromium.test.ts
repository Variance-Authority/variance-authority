import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from '@playwright/test';
import { caseIndexOf, decodeExecutionIndex, openSetColumns } from '@variance-authority/sense/test-selection';
import { afterAll, describe, expect, it } from 'vitest';
// A case's lines are read by sense's selection, which publishes no reader of
// them, so this reads them the way it does.
import { lineAt, linesOf } from '../../sense/src/test-selection/case-lines.js';

// A real Playwright run over a spec whose page enters a region for each thing
// it does, recorded through `withTestSelection` — with the cut, and without.
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../..');
const fixture = resolve(here, '../test/fixtures/cadence');
const at = (path: string) => `packages/playwright-test/test/fixtures/cadence/${path}`;
const directories: string[] = [];

const BROWSER_AVAILABLE = ((): boolean => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

if (!BROWSER_AVAILABLE) {
  console.warn(
    '\npackages/playwright-test cadence: skipped.' +
      '\n  no browser — npx playwright install chromium\n',
  );
}

afterAll(async () => {
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
});

interface Run {
  /** The line of the spec that reached each function of `src/shop.ts`. */
  readonly reached: Readonly<Record<string, unknown>>;
  /** The title of every Playwright API step the run showed, in order. */
  readonly steps: readonly string[];
}

/** One run of the fixture with `env`. */
async function runWith(env: Readonly<Record<string, string>>): Promise<Run> {
  const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-playwright-cadence-'));
  directories.push(directory);
  const coverageFile = resolve(directory, 'coverage.bin');
  const stepsFile = resolve(directory, 'steps.txt');
  await promisify(execFile)(
    process.execPath,
    [resolve(repository, 'node_modules/@playwright/test/cli.js'), 'test', '--config', resolve(fixture, 'playwright.config.mjs')],
    {
      cwd: fixture,
      env: {
        ...process.env,
        ...env,
        VARIANCE_AUTHORITY_COVERAGE: coverageFile,
        VARIANCE_AUTHORITY_CACHE: resolve(directory, 'cache'),
        VARIANCE_AUTHORITY_STEPS: stepsFile,
      },
    },
  );
  const steps = existsSync(stepsFile) ? (await readFile(stepsFile, 'utf8')).split('\n').filter(Boolean) : [];
  const cases = await caseIndexOf(coverageFile);
  if (cases === undefined) throw new Error('the run wrote no execution index');
  const index = decodeExecutionIndex(cases);
  const test = index.tests.findIndex((entry) => entry.id === `${at('tests/shop.spec.ts')} > pays for what it chose`);
  expect(test, index.tests.map((entry) => entry.id).join(', ')).toBeGreaterThanOrEqual(0);
  const lines = linesOf(openSetColumns(cases)!.testLines, test);
  const module = index.modules.findIndex((entry) => entry.file === at('src/shop.ts'));
  const source = (await readFile(resolve(fixture, 'src/shop.ts'), 'utf8')).split('\n');
  const reached: Record<string, unknown> = {};
  for (const name of ['open', 'choose', 'pay']) {
    const line = source.findIndex((text) => text.includes(`function ${name}(`)) + 1;
    const block = index.modules[module]!.blocks.findLastIndex((entry) => entry.startLine <= line && line <= entry.endLine);
    reached[name] = lines === undefined ? undefined : lineAt(lines, module, block);
  }
  return { reached, steps };
}

describe.runIf(BROWSER_AVAILABLE)('a Playwright spec cut statement by statement', () => {
  it("charges each region to the statement that first reached it, a hook's as a hook's, unless the run turns the cut off", async () => {
    const spec = (await readFile(resolve(fixture, 'tests/shop.spec.ts'), 'utf8')).split('\n');
    const line = (statement: string, ambient = false) => ({ line: spec.findIndex((text) => text.endsWith(`// ${statement}`)) + 1, ambient });

    const cut = await runWith({});
    const uncut = await runWith({ VARIANCE_AUTHORITY_CADENCE: 'off' });

    // `opens` is the beforeEach's statement.
    expect(cut.reached).toEqual({ open: line('opens', true), choose: line('chooses'), pay: line('pays') });
    expect(uncut.reached).toEqual({ open: undefined, choose: undefined, pay: undefined });
    // The drains are the recording's, not the test's: none shows as a step, in
    // the report, the trace or the inspector.
    expect(cut.steps).toEqual(uncut.steps);
    expect(cut.steps.filter((title) => /evaluate/i.test(title))).toEqual([]);
  }, 120_000);
});
