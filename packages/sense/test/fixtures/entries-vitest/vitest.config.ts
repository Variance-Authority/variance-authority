import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/vitest';
import { defineConfig } from 'vitest/config';

// The fast recipe: modules and functions only, and which of them ran before
// the first test of each file.
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
    mode: 'entries',
  },
);
