import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/rstest';

const root = fileURLToPath(new URL('.', import.meta.url));
const source = resolve(root, 'src');
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
if (coverageFile === undefined) throw new Error('VARIANCE_AUTHORITY_COVERAGE is required');

export default withTestSelection(
  { root, globals: true, include: ['test/*.case.ts'] },
  // A body its runner timed out is still running when the retry starts, which
  // only the async context tells apart.
  { coverageFile, continuations: true, include: (file) => file.startsWith(source) },
);
