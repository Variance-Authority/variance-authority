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

type Story = ReturnType<typeof stories.decodeStory>;

/** The stories one run with stories on wrote, by case name; one run serves every case below. */
let written: Promise<{ readonly directory: string; readonly byName: ReadonlyMap<string, Story> }> | undefined;
function storiesWritten() {
  written ??= (async () => {
    const directory = await runWith({ VARIANCE_AUTHORITY_STORY: '1' });
    const files = await readdir(resolve(directory, 'coverage.stories'));
    const decoded = await Promise.all(
      files.map(async (name) => stories.decodeStory(await readFile(resolve(directory, 'coverage.stories', name)))),
    );
    return { directory, byName: new Map(decoded.map((story) => [story.name, story])) };
  })();
  return written;
}

/** Each visit of `story` as the function of `src/shop.js` its region is in, a repeat folded. */
async function routeOf(directory: string, story: Story): Promise<string[]> {
  const index = decodeExecutionIndex((await caseIndexOf(resolve(directory, 'coverage.bin')))!);
  const blocks = index.modules.find((entry) => entry.file === at('src/shop.js'))!.blocks;
  const source = (await readFile(resolve(fixture, 'src/shop.js'), 'utf8')).split('\n');
  const placeOf = (block: (typeof blocks)[number]): string =>
    block.kind === 'module'
      ? 'top level'
      : source.slice(0, block.startLine).findLast((text) => text.startsWith('function '))!.split(/[ (]/)[1]!;
  const route = [...story.visits].map((visit) => placeOf(blocks[visit & 0x7fffffff]!));
  return route.filter((place, step) => place !== route[step - 1]);
}

/**
 * What `story` told, in order: each statement's line where it began, by the
 * name the spec's comment gives it, and what the page printed and its regions were
 * handed, where it happened. A line counts the notes said before it, as a
 * route reads it.
 */
async function toldIn(spec: string, story: Story): Promise<string[]> {
  const text = (await readFile(resolve(fixture, 'tests', spec), 'utf8')).split('\n');
  // A statement is a line of code that ends in a comment, not a comment line.
  const named = new Map(
    text.flatMap((line, index) => {
      const statement = /^\s*[^/\s].*\/\/ (.+)$/.exec(line)?.[1];
      return statement === undefined ? [] : [[index + 1, statement] as const];
    }),
  );
  return [
    ...story.lines.map(([, number, said]) => [said, 0, `test line ${named.get(number) ?? number}`] as const),
    ...story.notes.map(([, note], index) => [index, 1, note] as const),
  ]
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .map(([, , told]) => told);
}

describe.runIf(BROWSER_AVAILABLE)('a Playwright case run in a page', () => {
  it('writes its story, in the order the page went, at the spec line each statement is on', async () => {
    const { directory, byName } = await storiesWritten();
    const story = byName.get('pays for what it chose')!;

    expect({ file: story.file, name: story.name, stopped: story.stopped }).toEqual({
      file: at('tests/shop.spec.ts'),
      name: 'pays for what it chose',
      stopped: false,
    });
    const shop = moduleId(at('src/shop.js'), await readFile(resolve(fixture, 'src/shop.js'), 'utf8'));
    expect(story.rows.map(([id]) => id)).toEqual([shop]);
    expect(await routeOf(directory, story)).toEqual(['top level', 'open', 'choose', 'pay']);
    expect(story.lines.every(([, , , hook]) => hook === undefined)).toBe(true);
    expect(await toldIn('shop.spec.ts', story)).toEqual([
      'test line opens',
      'holds open=ref1 function open, choose=ref2 function choose, pay=ref3 function pay',
      'test line looks',
      'test line chooses',
      "handed item='tea'",
      'console.log chose tea',
      // What the spec prints in Node is said where the spec was.
      'test line says',
      'console.log chose in the spec',
      'test line pays',
      'handed amount=20',
      'test line checks',
    ]);
  }, 120_000);

  it('writes the story of a page in a context the spec made itself', async () => {
    const { directory, byName } = await storiesWritten();
    const story = byName.get('pays in a context it made');

    expect({ file: story?.file, stopped: story?.stopped }).toEqual({ file: at('tests/own-context.spec.ts'), stopped: false });
    expect(await routeOf(directory, story!)).toEqual(['top level', 'choose', 'pay']);
    expect(await toldIn('own-context.spec.ts', story!)).toEqual([
      'test line opens',
      'holds open=ref1 function open, choose=ref2 function choose, pay=ref3 function pay',
      'test line chooses',
      "handed item='tea'",
      'console.log chose tea',
      'test line pays',
      'handed amount=20',
      'test line closes',
    ]);
  }, 120_000);

  it('keeps what a document ran under the statement that replaced it', async () => {
    const { directory, byName } = await storiesWritten();
    const story = byName.get('pays after the page it chose on was replaced')!;

    expect({ file: story.file, stopped: story.stopped }).toEqual({ file: at('tests/navigates.spec.ts'), stopped: false });
    // The second document runs the module from its top level again.
    expect(await routeOf(directory, story)).toEqual(['top level', 'choose', 'top level', 'pay']);
    expect(await toldIn('navigates.spec.ts', story)).toEqual([
      'test line opens',
      'holds open=ref1 function open, choose=ref2 function choose, pay=ref3 function pay',
      'test line leaves',
      "handed item='jam'",
      'console.log chose jam',
      'holds open=ref1 function open, choose=ref2 function choose, pay=ref3 function pay',
      'test line pays',
      'handed amount=20',
    ]);
  }, 120_000);

  it('writes none when the run did not ask', async () => {
    const directory = await runWith({});
    expect(existsSync(resolve(directory, 'coverage.stories'))).toBe(false);
  }, 120_000);
});
