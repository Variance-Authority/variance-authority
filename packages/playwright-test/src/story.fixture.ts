import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { runDirectory } from './runs.fixture.js';

// What the tests of a Playwright case's story drive: a real Playwright run over
// a page an instrumented build serves, recorded through `withTestSelection`.

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../..');

export const fixture = resolve(here, '../test/fixtures/story');

/** A file of the fixture, by the path the record names it with. */
export const at = (path: string) => `packages/playwright-test/test/fixtures/story/${path}`;

// A reading is read back by `variance story`, which reads it with sense's
// decoder; sense publishes none, so this requires the one it builds.
export const stories = createRequire(import.meta.url)(resolve(repository, 'packages/sense/dist/story/format.cjs')) as {
  decodeStory(bytes: Uint8Array): {
    file: string; name: string; stopped?: boolean; rows: [string, number][]; visits: Int32Array; notes: [number, string][]; lines: [number, number, number, 1?][];
  };
};

export type Story = ReturnType<typeof stories.decodeStory>;

/** One run of the fixture with `env`; the directory its record went to. */
export async function runWith(env: Readonly<Record<string, string>>): Promise<string> {
  const directory = await runDirectory('variance-authority-playwright-story-');
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
