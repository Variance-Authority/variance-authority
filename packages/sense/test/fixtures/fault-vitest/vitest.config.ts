import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/vitest';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));
const source = resolve(root, 'src');
// Named by a test that reads the record itself; else the repository's integration suite's.
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];

export default withTestSelection(
  defineConfig({
    root,
    test: { include: ['test/*.test.js'] },
  }),
  {
    ...(coverageFile === undefined ? { suite: 'integration' } : { coverageFile }),
    include: (file) => file.startsWith(source),
  },
);
