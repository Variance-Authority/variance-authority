import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/vitest';
import { defineConfig } from 'vitest/config';

// The same seam over a suite that runs in a document. Its own include, so the
// file stays out of the runs the other configurations here make.
const root = fileURLToPath(new URL('.', import.meta.url));
const source = resolve(root, 'src');
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
if (coverageFile === undefined) throw new Error('VARIANCE_AUTHORITY_COVERAGE is required');

export default withTestSelection(
  defineConfig({
    root,
    test: {
      include: ['test/*.dom.ts'],
      setupFiles: ['test/setup.ts'],
    },
  }),
  {
    coverageFile,
    include: (file) => file.startsWith(source),
  },
);
