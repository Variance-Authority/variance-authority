/**
 * The same project again, with `globals: true` and cases.
 *
 * The other two configurations both read the registrars off the object an
 * import of `@rstest/core` compiles to. This one declares with the realm's
 * `it` and nothing else, so the other half of the seam is the half under test.
 * Both spellings are exercised because a seam is not allowed to be believed:
 * the placement nobody runs is the placement that silently records nothing.
 *
 * Its own `include`, so the files the other two configurations enumerate stay
 * exactly the files they enumerated.
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
    include: ['test/*.injected.ts'],
    setupFiles: ['./test/setup.mjs'],
  },
  {
    coverageFile,
    include: (file) => file.startsWith(source),
    preconditions: ['rstest.injected.config.mjs'],
    cases: true,
  },
);
