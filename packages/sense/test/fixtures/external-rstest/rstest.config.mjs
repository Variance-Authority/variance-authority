import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/rstest';

const root = fileURLToPath(new URL('.', import.meta.url));
const source = resolve(root, 'src');
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
if (coverageFile === undefined) {
  throw new Error('VARIANCE_AUTHORITY_COVERAGE is required');
}

export default withTestSelection(
  {
    root,
    globals: true,
    include: ['test/*.case.ts'],
    setupFiles: ['./test/setup.mjs'],
  },
  { coverageFile, include: (file) => file.startsWith(source), preconditions: ['rstest.config.mjs'] },
);
