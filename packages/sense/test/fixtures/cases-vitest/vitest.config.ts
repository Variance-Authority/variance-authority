import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/vitest';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));
const source = resolve(root, 'src');
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
if (coverageFile === undefined) throw new Error('VARIANCE_AUTHORITY_COVERAGE is required');
// `off` records the same suite a file at a time, from this same file: the seam
// declares the config it loaded, so a second file would be a second
// precondition and the two snapshots would differ by name rather than recipe.
const cases = process.env['VARIANCE_AUTHORITY_CASES'] !== 'off';

export default withTestSelection(
  defineConfig({
    root,
    test: { include: ['test/*.case.ts'], environment: 'node' },
  }),
  {
    coverageFile,
    cases,
    // One of the two test files is a `describe.concurrent` on purpose, so this
    // fixture is one of the few suites that needs the async context.
    continuations: cases,
    include: (file) => file.startsWith(source),
  },
);
