import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { chromium } from '@playwright/test';
import { moduleId } from '@variance-authority/sense/journal';
import { caseIndexOf, decodeExecutionIndex } from '@variance-authority/sense/test-selection';
import { afterAll, describe, expect, it } from 'vitest';

// A real Playwright run over a page an instrumented build serves, recorded
// through `withTestSelection` with `VARIANCE_AUTHORITY_STORY=1`.
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../..');
const fixture = resolve(here, '../test/fixtures/story');
const at = (path: string) => `packages/playwright-test/test/fixtures/story/${path}`;
const directories: string[] = [];
// A reading is read back by `variance story`, which reads it with sense's
// decoder; sense publishes none, so this requires the one it builds.
const stories = createRequire(import.meta.url)(resolve(repository, 'packages/sense/dist/story/format.cjs')) as {
  decodeStory(bytes: Uint8Array): {
    file: string; name: string; stopped?: boolean; rows: [string, number][]; visits: Int32Array; notes: [number, string][]; lines: [number, number, number, 1?][];
  };
};

const BROWSER_AVAILABLE = ((): boolean => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

if (!BROWSER_AVAILABLE) {
  console.warn('\npackages/playwright-test story: skipped.\n  no browser — npx playwright install chromium\n');
}

afterAll(async () => {
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
});

/** One run of the fixture with `env`; the directory its record went to. */
async function runWith(env: Readonly<Record<string, string>>): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-playwright-story-'));
  directories.push(directory);
  await promisify(execFile)(
    process.execPath,
    [resolve(repository, 'node_modules/@playwright/test/cli.js'), 'test', '--config', resolve(fixture, 'playwright.config.mjs')],
    {
      cwd: fixture,
      env: {
        ...process.env,
        ...env,
        VARIANCE_AUTHORITY_COVERAGE: resolve(directory, 'coverage.bin'),
        VARIANCE_AUTHORITY_CACHE: resolve(directory, 'cache'),
      },
    },
  );
  return directory;
}

describe.runIf(BROWSER_AVAILABLE)('a Playwright case run in a page', () => {
  it('writes its story, in the order the page went, at the spec line each statement is on', async () => {
    const directory = await runWith({ VARIANCE_AUTHORITY_STORY: '1' });
    const written = await readdir(resolve(directory, 'coverage.stories'));
    expect(written).toHaveLength(1);
    const story = stories.decodeStory(await readFile(resolve(directory, 'coverage.stories', written[0]!)));

    expect({ file: story.file, name: story.name, stopped: story.stopped }).toEqual({
      file: at('tests/shop.spec.ts'),
      name: 'pays for what it chose',
      stopped: false,
    });
    const shop = moduleId(at('src/shop.js'), await readFile(resolve(fixture, 'src/shop.js'), 'utf8'));
    expect(story.rows.map(([id]) => id)).toEqual([shop]);

    // Each visit as the function of `src/shop.js` its region is in.
    const index = decodeExecutionIndex((await caseIndexOf(resolve(directory, 'coverage.bin')))!);
    const blocks = index.modules.find((entry) => entry.file === at('src/shop.js'))!.blocks;
    const source = (await readFile(resolve(fixture, 'src/shop.js'), 'utf8')).split('\n');
    const placeOf = (block: (typeof blocks)[number]): string =>
      block.kind === 'module'
        ? 'top level'
        : source.slice(0, block.startLine).findLast((text) => text.startsWith('function '))!.split(/[ (]/)[1]!;
    const route = [...story.visits].map((visit) => placeOf(blocks[visit & 0x7fffffff]!));
    expect(route.filter((place, step) => place !== route[step - 1])).toEqual(['top level', 'open', 'choose', 'pay']);

    // Each statement's line is where it began; what the page printed, and what
    // its regions were handed, where it happened, as a Node case says them.
    // A line counts the notes said before it, as a route reads it.
    const spec = (await readFile(resolve(fixture, 'tests/shop.spec.ts'), 'utf8')).split('\n');
    const line = (statement: string) => spec.findIndex((text) => text.endsWith(`// ${statement}`)) + 1;
    const told = [
      ...story.lines.map(([, number, said]) => [said, 0, `test line ${number}`] as const),
      ...story.notes.map(([, text], index) => [index, 1, text] as const),
    ].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    expect(story.lines.every(([, , , hook]) => hook === undefined)).toBe(true);
    expect(told.map(([, , text]) => text)).toEqual([
      `test line ${line('opens')}`,
      'holds open=ref1 function open, choose=ref2 function choose, pay=ref3 function pay',
      `test line ${line('looks')}`,
      `test line ${line('chooses')}`,
      "handed item='tea'",
      'console.log chose tea',
      `test line ${line('pays')}`,
      'handed amount=20',
      `test line ${line('checks')}`,
    ]);
  }, 120_000);

  it('writes none when the run did not ask', async () => {
    const directory = await runWith({});
    expect(existsSync(resolve(directory, 'coverage.stories'))).toBe(false);
  }, 120_000);
});
