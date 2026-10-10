import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/vitest';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));
const source = resolve(root, 'src');
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
if (coverageFile === undefined) throw new Error('VARIANCE_AUTHORITY_COVERAGE is required');

/** The modules whose functions are run in the page, where a probe has no runtime to report to. */
const crossing = new Set([resolve(source, 'harness.ts'), resolve(source, 'world.ts')]);

export default withTestSelection(
  defineConfig({
    root,
    test: { include: ['test/*.test.js'] },
  }),
  {
    coverageFile,
    include: (file) => file.startsWith(source) && !crossing.has(file),
    unprobed: (file) => crossing.has(file),
  },
);
