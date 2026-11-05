import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { caseIndexOf, decodeExecutionIndex, openSetColumns } from '@variance-authority/sense/test-selection';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// A case's lines are read by sense's selection, which publishes no reader of
// them, so this reads them the way it does.
import { lineAt, linesOf } from '../../../packages/sense/src/test-selection/case-lines.js';
import { unbuilt } from '../../unbuilt.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../..');
const fixture = resolve(here, '../fixture');
const at = (path: string): string => `cases/playwright-oldest-case/fixture/${path}`;
// The Playwright this case installs, not the repository's own: the run under test is the oldest's.
const installed = resolve(here, '../node_modules/@playwright/test');
const cli = resolve(installed, 'cli.js');
const version = (JSON.parse(readFileSync(resolve(installed, 'package.json'), 'utf8')) as { version: string }).version;

// The browser the repository's Playwright installed, because no machine that
// runs this suite holds the build the oldest one would ask for.
const browser = ((): string | undefined => {
  const { chromium } = createRequire(import.meta.url)(resolve(repository, 'node_modules/@playwright/test')) as {
    chromium: { executablePath(): string };
  };
  try {
    return existsSync(chromium.executablePath()) ? chromium.executablePath() : undefined;
  } catch {
    return undefined;
  }
})();

if (browser === undefined) {
  unbuilt(
    '\ncases/playwright-oldest-case, the record test: skipped.' +
      '\n  no browser — npx playwright install chromium\n',
  );
}

let directory: string;
const coverage = (): string => resolve(directory, 'coverage.bin');
const playwright = (...flags: string[]) =>
  promisify(execFile)(process.execPath, [cli, 'test', '--config', resolve(fixture, 'playwright.config.mjs'), ...flags], {
    cwd: fixture,
    env: {
      ...process.env,
      // A workspace link's real path resolves the repository's Playwright, and
      // two in one process refuse to load. An install has one, and this keeps
      // the link where an install would put the package.
      NODE_OPTIONS: '--preserve-symlinks',
      VARIANCE_AUTHORITY_COVERAGE: coverage(),
      VARIANCE_AUTHORITY_CACHE: resolve(directory, 'cache'),
      FIXTURE_CHROMIUM: browser,
    },
  });

beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-playwright-oldest-'));
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('the oldest Playwright this project takes', () => {
  it('is the one this case installs', () => {
    const manifest = JSON.parse(readFileSync(resolve(repository, 'packages/playwright-test/package.json'), 'utf8')) as {
      peerDependencies: Record<string, string>;
    };

    expect(manifest.peerDependencies['@playwright/test']).toBe(`>=${version.split('.').slice(0, 2).join('.')} <2`);
  });

  it('refuses a shard, which it would split test by test', async () => {
    await expect(playwright('--shard', '1/2')).rejects.toMatchObject({
      stderr: expect.stringContaining('refusing shard 1/2'),
    });
  });

  it.runIf(browser !== undefined)('records the spec line that first reached each region of the page', async () => {
    await playwright();

    const cases = (await caseIndexOf(coverage()))!;
    const index = decodeExecutionIndex(cases);
    const test = index.tests.findIndex((entry) => entry.id === `${at('tests/shop.spec.ts')} > pays for what it chose`);
    const lines = linesOf(openSetColumns(cases)!.testLines, test);
    const module = index.modules.findIndex((entry) => entry.file === at('src/shop.js'));
    const source = (await readFile(resolve(fixture, 'src/shop.js'), 'utf8')).split('\n');
    const spec = (await readFile(resolve(fixture, 'tests/shop.spec.ts'), 'utf8')).split('\n');
    const named = (statement: string) => spec.findIndex((text) => text.endsWith(`// ${statement}`)) + 1;
    const reached = (name: string) => {
      const line = source.findIndex((text) => text.startsWith(`function ${name}(`)) + 1;
      const blocks = index.modules[module]!.blocks;
      const block = blocks.findLastIndex((entry) => entry.startLine <= line && line <= entry.endLine);
      return lines === undefined ? undefined : lineAt(lines, module, block);
    };

    expect({ choose: reached('choose'), pay: reached('pay') }).toEqual({
      choose: { line: named('chooses'), ambient: false },
      pay: { line: named('pays'), ambient: false },
    });
  }, 120_000);
});
