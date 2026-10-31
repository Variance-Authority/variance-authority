import { fileURLToPath } from 'node:url';
import { isolate } from '@variance-authority/isolator/transform';
import { defineConfig, type Plugin } from 'vitest/config';

// A project that runs Vitest the way a fast suite does: one worker, and the
// module graph it builds kept across files. The outer test picks what resets
// the state those modules hold, in FIXTURE_RESETS:
//   none      nothing
//   ioc       the driver, running the handlers modules registered
//   isolator  the driver, and every application module isolated
// FIXTURE_ISOLATE=true turns Vitest's own per-file isolation back on.
const root = fileURLToPath(new URL('.', import.meta.url));
const resets = process.env['FIXTURE_RESETS'] ?? 'none';

// The isolator ships no Vite plugin; its README tells another build tool to
// call `isolate` itself, on the file as it is on disk, skipping test files and
// `node_modules`. This is that call.
const isolator: Plugin = {
  name: 'isolator',
  enforce: 'pre',
  transform(code, id) {
    const path = id.split('?')[0]!;
    if (!/\.[cm]?[jt]sx?$/.test(path) || path.includes('/node_modules/') || path.endsWith('.case.ts')) return undefined;
    if (!path.startsWith(root)) return undefined;
    const { code: rewritten, map, left } = isolate(code, path);
    for (const { line, name, reason } of left) this.warn(`isolator: ${path}:${line} \`${name}\` stays shared: ${reason}`);
    return { code: rewritten, map };
  },
};

export default defineConfig({
  root,
  plugins: resets === 'isolator' ? [isolator] : [],
  test: {
    include: ['*.case.ts'],
    isolate: process.env['FIXTURE_ISOLATE'] === 'true',
    pool: 'forks',
    fileParallelism: false,
    setupFiles: resets === 'none' ? [] : ['./reset.setup.ts'],
  },
});
