import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/vitest';
import { defineConfig } from 'vitest/config';

// The file recipe: no probe, one line after each module, and a record of which
// files each test loaded. No setup file, so a test that never imports
// `src/decide.ts` does not load it.
const root = fileURLToPath(new URL('.', import.meta.url));
const source = resolve(root, 'src');
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
if (coverageFile === undefined) throw new Error('VARIANCE_AUTHORITY_COVERAGE is required');

export default withTestSelection(
  defineConfig({
    root,
    test: {
      include: ['test/*.case.ts'],
      environment: 'node',
    },
  }),
  {
    coverageFile,
    include: (file) => file.startsWith(source),
    mode: 'loads',
  },
);
