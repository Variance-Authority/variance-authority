import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

// Built, as the seam loads them: the format's own requires resolve only in `dist/`.
const stories = (await import('../../dist/story/format.cjs')).default as typeof import('../story/format.cjs');
const { readRoute } = (await import('../../dist/story/read.js')) as typeof import('../story/read.js');
const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/external-rstest');
const at = (path: string): string => `${relative(repository, fixture)}/${path}`;
const rstest = resolve(repository, 'node_modules/@rstest/core/bin/rstest.js');
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('an Rstest file that runs in a page, under `VARIANCE_AUTHORITY_STORY=1`', () => {
  it('writes each case a story read as a Node case\'s is: the code the page ran in order, what it printed, its test lines', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-rstest-page-story-'));
    temporary.push(directory);
    // Rstest's browser mode: the file is bundled, served, and run in Chromium.
    await execute(process.execPath, [rstest, 'run', '-c', resolve(fixture, 'rstest.browser.config.mjs')], {
      cwd: fixture,
      env: {
        ...process.env,
        VARIANCE_AUTHORITY_COVERAGE: resolve(directory, 'coverage.bin'),
        VARIANCE_AUTHORITY_CACHE: directory,
        VARIANCE_AUTHORITY_STORY: '1',
      },
    });

    const written = (await readdir(directory, { recursive: true }))
      .filter((path) => path.endsWith('.story'))
      .map((path) => resolve(directory, path));
    const decoded = await Promise.all(written.map(async (path) => ({ path, story: stories.decodeStory(await readFile(path)) })));
    const named = (name: string) => decoded.find(({ story }) => story.name === name);
    expect(decoded.map(({ story }) => story.name).sort()).toEqual(['in a page > takes the alpha path', 'in a page > takes the gamma path']);

    const alpha = named('in a page > takes the alpha path')!;
    expect(alpha.story).toMatchObject({ file: resolve(fixture, 'test/delta.browser.ts'), stopped: false });
    // The two statements of the test, in the order the page ran them, what the
    // first printed, and the value the second handed the product.
    expect(alpha.story.lines.map(([, line]) => line)).toEqual([6, 7]);
    expect(alpha.story.notes.map(([, text]) => text)).toEqual(['console.log deciding alpha', "handed value='alpha'"]);
    expect(named('in a page > takes the gamma path')!.story.notes.map(([, text]) => text)).toEqual(["handed value='gamma'"]);

    // Read as `variance story` reads it: every region named by its coordinate in the record beside it.
    const turn = (path: string) => {
      const route = readRoute(repository, path);
      expect(route.unresolved).toEqual([]);
      return route.route.map((step) => ('token' in step ? step.token : undefined))
        .find((token) => token !== undefined && 'place' in token && token.place.name === 'decide');
    };
    expect(turn(alpha.path)).toMatchObject({
      place: { file: at('src/decide.ts'), at: `${at('src/decide.ts')}#decide/entry` },
      arms: [{ path: 'if#0/then', at: `${at('src/decide.ts')}#decide/if#0/then` }],
    });
    // Past the first `if` by its `else`, and into the second.
    expect(turn(named('in a page > takes the gamma path')!.path)?.arms.map(({ path }) => path))
      .toEqual(['if#0/else', 'if#0/after', 'if#1/then']);
  }, 120_000);
});
