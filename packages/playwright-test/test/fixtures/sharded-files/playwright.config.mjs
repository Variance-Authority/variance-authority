import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import { withTestSelection } from '@variance-authority/playwright-test';

// Three spec files of three tests each, every test its own group: Playwright's
// own `--shard` would cut a file between shards.
const root = fileURLToPath(new URL('.', import.meta.url));
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
const cacheRoot = process.env['VARIANCE_AUTHORITY_CACHE'];
if (coverageFile === undefined || cacheRoot === undefined) {
  throw new Error('VARIANCE_AUTHORITY_COVERAGE and VARIANCE_AUTHORITY_CACHE are required');
}
// A selection handed in by the test that runs this fixture: the files to skip,
// as JSON. Absent, nothing is handed in and every file runs.
const skip = process.env['FIXTURE_SKIP'];
// A refusal the selection makes when it is read, as `selectSuite` refuses a record it cannot read.
const refusal = process.env['FIXTURE_REFUSE'];
const selection =
  refusal !== undefined
    ? { selection: async () => { throw new Error(refusal); } }
    : skip !== undefined
      ? { selection: async () => ({ whole: new Set(JSON.parse(skip)), skip: new Set(JSON.parse(skip)), notes: [] }) }
      : {};

export default defineConfig(
  withTestSelection(
    {
      testDir: 'tests',
      fullyParallel: true,
      workers: 2,
      reporter: [['line']],
    },
    { root, cacheRoot, coverageFile, ...selection },
  ),
);
