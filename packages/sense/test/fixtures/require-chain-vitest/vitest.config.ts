import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/vitest';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));
const source = resolve(root, 'src');
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
if (coverageFile === undefined) throw new Error('VARIANCE_AUTHORITY_COVERAGE is required');

// `src/index.cjs` is CommonJS that Vite transforms, and what it requires Node
// loads: `include` takes all three files, so all three are recorded.
export default withTestSelection(
  defineConfig({ root, test: { include: ['test/*.case.ts'], environment: 'node' } }),
  { coverageFile, include: (file) => file.startsWith(source) },
);
