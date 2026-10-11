import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The test files to run in place of the four cases, as a glob, as
// `vitest.default.config.ts` reads it.
const include = process.env['FIXTURE_INCLUDE'];

// `vitest.default.config.ts` without the seam: what Vitest does on its own, for
// a test that holds a wrapped run to it.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    include: [include ?? 'test/*.case.ts'],
    environment: 'node',
    setupFiles: ['test/setup.ts'],
  },
});
