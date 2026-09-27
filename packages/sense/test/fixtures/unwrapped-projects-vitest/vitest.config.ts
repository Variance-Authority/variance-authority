import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/vitest';

// The configuration that describes the run, and the only one wrapped. Vitest 2
// lists the projects in `vitest.workspace.ts` beside it, and a project reads
// none of this file's plugins, setup files or runner: no module is
// instrumented and no case is recorded.
const root = fileURLToPath(new URL('.', import.meta.url));
const source = resolve(root, 'src');
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
if (coverageFile === undefined) throw new Error('VARIANCE_AUTHORITY_COVERAGE is required');

export default withTestSelection({ root, test: {} }, { coverageFile, include: (file) => file.startsWith(source) });
