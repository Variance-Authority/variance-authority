/**
 * The same project, asked for the per-case index as well.
 *
 * A second configuration rather than a flag on the first, because the first is
 * what proves a run that does not ask for cases writes exactly the bytes it
 * always did.
 *
 * `globals` is off here, and the test files import `it` and `expect`. The
 * per-case index is recorded all the same: the seam wraps the registrars on
 * the API object Rstest injects, which is what an import of `@rstest/core`
 * reads.
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

export default withTestSelection(
  {
    root,
    globals: false,
    include: ['test/*.case.ts'],
    setupFiles: ['./test/setup.mjs'],
  },
  { coverageFile, include: (file) => file.startsWith(source), preconditions: ['rstest.cases.config.mjs'] },
);
