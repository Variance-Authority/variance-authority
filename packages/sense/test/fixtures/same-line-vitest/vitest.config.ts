import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/vitest';
import { defineConfig } from 'vitest/config';

// `build/pick.js` is what a build made of `src/pick.ts`, with the map that leads
// back to it: one test reaches the source, the other the build.
const root = fileURLToPath(new URL('.', import.meta.url));
const recorded = [resolve(root, 'src'), resolve(root, 'build')];
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
if (coverageFile === undefined) throw new Error('VARIANCE_AUTHORITY_COVERAGE is required');

export default withTestSelection(
  defineConfig({
    root,
    test: { include: ['test/*.case.ts'] },
  }),
  {
    coverageFile,
    include: (file) => recorded.some((directory) => file.startsWith(directory)),
  },
);
