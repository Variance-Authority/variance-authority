import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/vitest';
import { defineConfig } from 'vitest/config';

// The quick-start shape: nothing said about `include`, so the default decides
// what is product source.
const root = fileURLToPath(new URL('.', import.meta.url));
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
if (coverageFile === undefined) throw new Error('VARIANCE_AUTHORITY_COVERAGE is required');

export default withTestSelection(
  defineConfig({
    root,
    test: {
      include: ['test/*.case.ts'],
      environment: 'node',
      setupFiles: ['test/setup.ts'],
    },
  }),
  { coverageFile },
);
