import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'packages/*/test/**/*.test.ts',
      'examples/*/src/**/*.test.{ts,tsx}',
    ],
    // `node` is the default; corpus fixtures opt into jsdom per-file with a
    // `// @vitest-environment jsdom` docblock, so the DOM-free packages stay
    // DOM-free (ADR-0001) and nothing accidentally acquires a `document`.
    environment: 'node',
  },
  esbuild: {
    jsx: 'automatic',
  },
});
