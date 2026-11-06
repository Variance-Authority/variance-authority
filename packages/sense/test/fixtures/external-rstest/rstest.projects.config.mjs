/**
 * The same test files under two projects, each allowing a case a different time.
 *
 * One reporter hears both, so a case is held to the longer of the two.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/rstest';

const root = fileURLToPath(new URL('.', import.meta.url));
const source = resolve(root, 'src');
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
if (coverageFile === undefined) {
  throw new Error('VARIANCE_AUTHORITY_COVERAGE is required');
}
const options = { coverageFile, include: (file) => file.startsWith(source), preconditions: ['rstest.projects.config.mjs'] };
const project = (name, testTimeout) => withTestSelection(
  { name, root, globals: false, testTimeout, include: ['test/*.case.ts'], setupFiles: ['./test/setup.mjs'] },
  options,
);

export default withTestSelection({ root, projects: [project('long', 6543), project('short', 1234)] }, options);
