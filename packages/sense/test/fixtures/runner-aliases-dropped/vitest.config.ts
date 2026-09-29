import { defineConfig } from 'vitest/config';

// Vitest's `test.alias` is tried first; a resolver and a computed replacement
// are nothing a table can carry, so each is named rather than read.
export default defineConfig({
  resolve: {
    alias: [
      { find: '@kept', replacement: './src/kept.ts' },
      { find: '@custom', replacement: './src/custom.ts', customResolver: () => null },
      { find: '@made', replacement: ((specifier: string) => specifier) as unknown as string },
    ],
  },
  test: { alias: { '@test': './src/test.ts' } },
});
