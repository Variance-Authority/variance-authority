/**
 * A story's story out of a real Storybook: built by `storybook build --test`
 * with the addon, served and driven by the collector with `tests` on and
 * `VARIANCE_AUTHORITY_STORY=1`, as a project runs it.
 */

import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { storyDirectory } from '@variance-authority/sense/story';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { storybookCollector } from './index.js';

const require = createRequire(import.meta.url);
const ADDON = resolve(import.meta.dirname, 'preset.ts');
const STORYBOOK = resolve(dirname(require.resolve('storybook/package.json')), 'bin/index.cjs');
// A reading is read back by `variance story`, which reads it with sense's
// decoder; sense publishes none, so this requires the one it builds.
const stories = require(resolve(import.meta.dirname, '../../sense/dist/story/format.cjs')) as {
  decodeStory(bytes: Uint8Array): { file: string; name: string; stopped?: boolean; visits: Int32Array; notes: [number, string][] };
};

const BROWSER_AVAILABLE = ((): boolean => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

if (!BROWSER_AVAILABLE) {
  console.warn('\npackages/storybook-collector story: skipped.\n  no browser — npx playwright install chromium\n');
}

const temporary: string[] = [];

afterAll(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

/** A React Vite Storybook in a checkout of its own, with one story that prints what it rendered. */
async function storybook(): Promise<string> {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), 'variance-authority-storybook-story-')));
  temporary.push(root);
  execFileSync('git', ['init', '-q'], { cwd: root });
  await mkdir(resolve(root, '.storybook'), { recursive: true });
  await mkdir(resolve(root, 'src'), { recursive: true });
  await symlink(resolve(import.meta.dirname, '../../../node_modules'), resolve(root, 'node_modules'), 'dir');
  await writeFile(resolve(root, 'package.json'), '{ "name": "storybook-story", "private": true, "type": "module" }\n');
  await writeFile(
    resolve(root, '.storybook/main.js'),
    `export default {\n` +
      `  stories: ['../src/*.stories.jsx'],\n` +
      `  framework: { name: '@storybook/react-vite', options: {} },\n` +
      `  core: { disableTelemetry: true },\n` +
      `  addons: [{ name: ${JSON.stringify(ADDON)}, options: { root: ${JSON.stringify(root)} } }],\n` +
      // Without it the stories compile against the classic runtime and throw `React is not defined`.
      `  viteFinal: async (config) => ({ ...config, esbuild: { ...config.esbuild, jsx: 'automatic' } }),\n` +
      `};\n`,
  );
  await writeFile(
    resolve(root, 'src/box.jsx'),
    'export function Box({ children }) {\n  console.log("boxed", children);\n  return <div>{children}</div>;\n}\n',
  );
  await writeFile(
    resolve(root, 'src/box.stories.jsx'),
    "import { Box } from './box.jsx';\nexport default { title: 'Box', component: Box };\nexport const One = { args: { children: 'one' } };\n",
  );
  await promisify(execFile)(process.execPath, [STORYBOOK, 'build', '--test', '--quiet', '-o', 'out'], {
    cwd: root,
    env: { ...process.env, CI: 'true' },
  });
  return root;
}

describe.runIf(BROWSER_AVAILABLE)('a story read under `VARIANCE_AUTHORITY_STORY=1`', () => {
  it('writes its story beside the record, under its declaration, with what it printed', async () => {
    const root = await storybook();
    const coverageFile = resolve(root, 'coverage.bin');
    vi.stubEnv('VARIANCE_AUTHORITY_STORY', '1');
    try {
      const collector = await storybookCollector({ tests: { root, coverageFile } })({
        config: {
          viewport: { width: 400, height: 300, deviceScaleFactor: 1, colorScheme: 'light' },
          subjects: { index: resolve(root, 'out/index.json') },
        },
      } as never);
      try {
        const read = await collector.collect({ subject: { id: 'story:box--one', kind: 'story' } } as never);
        expect(read.ok, (read as { because?: string }).because).toBe(true);
      } finally {
        await collector.close();
      }
    } finally {
      vi.unstubAllEnvs();
    }

    const directory = storyDirectory(coverageFile);
    const written = await Promise.all(
      (await readdir(directory)).map(async (name) => stories.decodeStory(await readFile(resolve(directory, name)))),
    );
    expect(written.map(({ file, name, stopped }) => ({ file, name, stopped }))).toEqual([
      { file: 'src/box.stories.jsx', name: 'Box/One', stopped: false },
    ]);
    expect(written[0]!.visits.length).toBeGreaterThan(0);
    expect(written[0]!.notes.map(([, text]) => text)).toContain('console.log boxed one');
  }, 240_000);
});
