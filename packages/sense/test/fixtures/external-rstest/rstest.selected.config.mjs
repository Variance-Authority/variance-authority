/**
 * The fixture's two test files, run with the selection a test hands in.
 *
 * `FIXTURE_SKIP` names the files to skip, as JSON; absent, the selection is the
 * one the environment asks for, as a project's own run reads it.
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
const skip = process.env['FIXTURE_SKIP'];

export default withTestSelection(
  {
    root,
    globals: true,
    include: ['test/*.case.ts'],
    setupFiles: ['./test/setup.mjs'],
  },
  {
    coverageFile,
    include: (file) => file.startsWith(source),
    ...(skip === undefined
      ? {}
      : { selection: async () => ({ whole: new Set(JSON.parse(skip)), skip: new Set(JSON.parse(skip)), notes: [] }) }),
  },
);
