import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/vitest';

// A project that runs Vitest 5 the way a fast suite does: one module graph
// shared across files in a worker, and every case in a file in flight at once.
// The test that runs it hands the selection in, as the files to skip in JSON;
// absent, every file runs.
const root = fileURLToPath(new URL('.', import.meta.url));
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
if (coverageFile === undefined) throw new Error('VARIANCE_AUTHORITY_COVERAGE is required');
const skip = process.env['FIXTURE_SKIP'];

export default withTestSelection(
  {
    root,
    test: { include: ['*.case.ts'], isolate: false, pool: 'forks', sequence: { concurrent: true } },
  },
  {
    coverageFile,
    continuations: true,
    include: (file) => file === resolve(root, 'add.ts'),
    ...(skip === undefined
      ? {}
      : { selection: async () => ({ whole: new Set<string>(JSON.parse(skip)), skip: new Set<string>(JSON.parse(skip)), notes: [] }) }),
  },
);
