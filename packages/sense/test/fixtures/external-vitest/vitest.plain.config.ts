import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// `vitest.default.config.ts` without the seam: what Vitest does on its own, for
// a test that holds a wrapped run to it.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    include: ['test/*.case.ts'],
    environment: 'node',
    setupFiles: ['test/setup.ts'],
  },
});
