import { fileURLToPath } from 'node:url';
import { isolator } from '@variance-authority/isolator/vite';
import { defineConfig } from 'vitest/config';

// A project that runs Vitest the way a fast suite does: one worker, and the
// module graph it builds kept across files. The outer test picks what resets
// the state those modules hold, in FIXTURE_RESETS:
//   none      nothing
//   ioc       the driver, running the handlers modules registered
//   isolator  the driver, and every application module isolated
// FIXTURE_ISOLATE=true turns Vitest's own per-file isolation back on, and
// FIXTURE_CONCURRENT=true runs the file of tests that run side by side instead,
// and FIXTURE_LIFECYCLE=true the files that read state at collection and after
// their `beforeAll` hooks.
const root = fileURLToPath(new URL('.', import.meta.url));
const resets = process.env['FIXTURE_RESETS'] ?? 'none';
const include =
  process.env['FIXTURE_CONCURRENT'] === 'true' ? '*.parallel.ts' : process.env['FIXTURE_LIFECYCLE'] === 'true' ? '*.lifecycle.ts' : '*.case.ts';

export default defineConfig({
  root,
  plugins: resets === 'isolator' ? [isolator()] : [],
  test: {
    include: [include],
    isolate: process.env['FIXTURE_ISOLATE'] === 'true',
    pool: 'forks',
    fileParallelism: false,
    setupFiles: resets === 'none' ? [] : ['./reset.setup.ts'],
  },
});
