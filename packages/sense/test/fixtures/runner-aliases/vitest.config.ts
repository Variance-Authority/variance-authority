import { defineConfig } from 'vitest/config';
import { source } from './where.js';

// The runner sends `@api` to the source, where a consumer would take the build.
export default defineConfig({
  resolve: { alias: [{ find: '@api', replacement: source }, { find: /^~\/(.*)$/, replacement: './src/$1' }] },
});
