import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/vitest';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));
const source = resolve(root, 'src');
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
if (coverageFile === undefined) throw new Error('VARIANCE_AUTHORITY_COVERAGE is required');

// `VARIANCE_AUTHORITY_FILES` picks `test/checkout.mocked.ts`, which fails when
// its cases run in the order they are written.
export default withTestSelection(
  defineConfig({
    root,
    test: { include: [process.env['VARIANCE_AUTHORITY_FILES'] ?? 'test/*.case.ts'], environment: 'node' },
  }),
  {
    coverageFile,
    include: (file) => file.startsWith(source),
  },
);
