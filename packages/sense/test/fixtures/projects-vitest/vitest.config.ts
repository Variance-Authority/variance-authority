import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/vitest';

// The configuration that describes the run. Vitest 2 lists the projects in
// `vitest.workspace.ts` beside it; this file governs every test they run.
const root = fileURLToPath(new URL('.', import.meta.url));
const source = resolve(root, 'src');
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
if (coverageFile === undefined) throw new Error('VARIANCE_AUTHORITY_COVERAGE is required');
// A selection handed in by the test that runs this fixture: the files to skip,
// as JSON. Absent, nothing is handed in and every file runs.
const skip = process.env['FIXTURE_SKIP'];
// A refusal the selection makes when it is read, as `selectSuite` refuses a record it cannot read.
const refusal = process.env['FIXTURE_REFUSE'];

export default withTestSelection({ root, test: {} }, {
  coverageFile,
  include: (file) => file.startsWith(source),
  ...(skip === undefined
    ? {}
    : { selection: async () => ({ whole: new Set<string>(JSON.parse(skip)), skip: new Set<string>(JSON.parse(skip)), notes: [] }) }),
  ...(refusal === undefined
    ? {}
    : { selection: async () => { throw new Error(refusal); } }),
});
