import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/vitest';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));
const source = resolve(root, 'src');
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
if (coverageFile === undefined) throw new Error('VARIANCE_AUTHORITY_COVERAGE is required');

// A project that configures its own runner: the seam's case runner stays out.
export default withTestSelection(
  defineConfig({
    root,
    test: { include: ['test/branch.case.ts'], environment: 'node', runner: resolve(root, 'own-runner.ts') },
  }),
  {
    coverageFile,
    include: (file) => file.startsWith(source),
  },
);
