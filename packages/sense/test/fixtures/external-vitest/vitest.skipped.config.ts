import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/vitest';
import { defineConfig } from 'vitest/config';

// One file, every test in it skipped. Its own include, so the file stays out of
// the runs the other configurations here make.
const root = fileURLToPath(new URL('.', import.meta.url));
const source = resolve(root, 'src');
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
if (coverageFile === undefined) throw new Error('VARIANCE_AUTHORITY_COVERAGE is required');

export default withTestSelection(
  defineConfig({
    root,
    test: {
      include: ['test/skipped.only.ts'],
      environment: 'node',
      setupFiles: ['test/setup.ts'],
    },
  }),
  {
    coverageFile,
    include: (file) => file.startsWith(source),
  },
);
