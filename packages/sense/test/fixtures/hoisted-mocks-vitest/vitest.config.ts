import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/vitest';
import { defineConfig } from 'vitest/config';

// Vitest hoists `vi.mock` and `vi.hoisted` in a transform that runs after the
// probes: `src/frozen.ts` mocks its own import, and `test/price.case.ts` mocks
// `src/price.ts` around its original.
const root = fileURLToPath(new URL('.', import.meta.url));
const source = resolve(root, 'src');
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
if (coverageFile === undefined) throw new Error('VARIANCE_AUTHORITY_COVERAGE is required');

export default withTestSelection(
  defineConfig({
    root,
    test: { include: ['test/*.case.ts'] },
  }),
  {
    coverageFile,
    include: (file) => file.startsWith(source),
  },
);
