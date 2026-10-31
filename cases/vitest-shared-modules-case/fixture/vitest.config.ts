import { fileURLToPath } from 'node:url';
import { isolator } from '@variance-authority/isolator/vite';
import { defineConfig } from 'vitest/config';

// A project that runs Vitest the way a fast suite does: one worker, and the
// module graph it builds kept across files. The outer test picks what resets
// the state those modules hold, in FIXTURE_RESETS:
//   none      nothing
//   ioc       the driver, running the handlers modules registered
//   isolator  the driver, and every application module isolated
// FIXTURE_ISOLATE=true turns Vitest's own per-file isolation back on.
const root = fileURLToPath(new URL('.', import.meta.url));
const resets = process.env['FIXTURE_RESETS'] ?? 'none';

export default defineConfig({
  root,
  plugins: resets === 'isolator' ? [isolator()] : [],
  test: {
    include: ['*.case.ts'],
    isolate: process.env['FIXTURE_ISOLATE'] === 'true',
    pool: 'forks',
    fileParallelism: false,
    setupFiles: resets === 'none' ? [] : ['./reset.setup.ts'],
  },
});
