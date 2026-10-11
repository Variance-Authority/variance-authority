import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/vitest';
import { defineConfig } from 'vitest/config';

// The quick-start shape: nothing said about `include`, so the default decides
// what is product source.
const root = fileURLToPath(new URL('.', import.meta.url));
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
if (coverageFile === undefined) throw new Error('VARIANCE_AUTHORITY_COVERAGE is required');
// A selection handed in by the test that runs this fixture: the files to skip,
// as JSON. Absent, nothing is handed in and every file runs.
const skip = process.env['FIXTURE_SKIP'];

export default withTestSelection(
  defineConfig({
    root,
    test: {
      include: ['test/*.case.ts'],
      environment: 'node',
      setupFiles: ['test/setup.ts'],
    },
  }),
  {
    coverageFile,
    ...(skip === undefined
      ? {}
      : { selection: async () => ({ whole: new Set<string>(JSON.parse(skip)), skip: new Set<string>(JSON.parse(skip)), notes: [] }) }),
  },
);
