import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/vitest';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));
const source = resolve(root, 'src');
const dependency = resolve(root, 'node_modules/half');
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
if (coverageFile === undefined) throw new Error('VARIANCE_AUTHORITY_COVERAGE is required');
const pool = process.env['REQUIRE_CHAIN_POOL'] === 'threads' ? 'threads' : 'forks';

// `src/index.cjs` is CommonJS that Vite transforms, and what it requires Node
// loads. `include` takes the three files of `src` and the `half` dependency,
// which no default takes, so all four are recorded.
export default withTestSelection(
  defineConfig({ root, test: { include: ['test/*.case.ts'], environment: 'node', pool } }),
  { coverageFile, include: (file) => file.startsWith(source) || file.startsWith(dependency) },
);
