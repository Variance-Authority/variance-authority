/**
 * The same project, running the one file whose case waits on a known line.
 *
 * A configuration of its own because the seam cuts the files the
 * configuration's `include` names, and an `--include` on the command line
 * never reaches it.
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
    globals: true,
    // A test names another file to run in place of the waiting one.
    include: [process.env['FIXTURE_INCLUDE'] ?? 'test/*.pace.ts'],
    setupFiles: ['./test/setup.mjs'],
  },
  {
    coverageFile,
    include: (file) => file.startsWith(source),
    preconditions: ['rstest.pace.config.mjs'],
    // A test asks for the file uncut, to see that nothing is timed then.
    ...(process.env['FIXTURE_CADENCE'] === 'off' ? { cadence: false } : {}),
    // A test whose case is stopped while the file goes on asks for a scope per case.
    ...(process.env['FIXTURE_CONTINUATIONS'] === 'on' ? { continuations: true } : {}),
  },
);
