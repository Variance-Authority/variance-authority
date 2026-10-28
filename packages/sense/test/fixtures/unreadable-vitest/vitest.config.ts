import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/vitest';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));
const source = resolve(root, 'src');
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
if (coverageFile === undefined) throw new Error('VARIANCE_AUTHORITY_COVERAGE is required');

export default withTestSelection(
  defineConfig({
    root,
    // A Flow file runs once its annotations are stripped, as a Flow project's
    // build does; the parser reads the committed text, which is not JavaScript.
    plugins: [
      {
        name: 'strip-flow',
        enforce: 'pre',
        transform: (code, id) => (id.endsWith('.js') && code.startsWith('// @flow') ? code.replace(/: string/g, '') : undefined),
      },
    ],
    test: { include: ['test/*.test.js'] },
  }),
  {
    coverageFile,
    include: (file) => file.startsWith(source),
  },
);
