import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/vitest';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));
const source = resolve(root, 'src');
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
if (coverageFile === undefined) throw new Error('VARIANCE_AUTHORITY_COVERAGE is required');

// Per-case recording the way a suite gets it by default: the case running now
// is a variable, and nothing follows a continuation. `VARIANCE_AUTHORITY_FILES`
// picks which of the two test files run, because one of them is concurrent on
// purpose and this recipe is the one that records it whole.
export default withTestSelection(
  defineConfig({
    root,
    test: {
      include: [process.env['VARIANCE_AUTHORITY_FILES'] ?? 'test/branch.case.ts'],
      environment: 'node',
    },
  }),
  {
    coverageFile,
    include: (file) => file.startsWith(source),
  },
);
