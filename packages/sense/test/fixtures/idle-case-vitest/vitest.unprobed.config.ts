import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/vitest';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
if (coverageFile === undefined) throw new Error('VARIANCE_AUTHORITY_COVERAGE is required');

// A run that instruments no module: its tests pass and it lays no coverage.
export default withTestSelection(
  defineConfig({ root, test: { include: ['test/*.case.ts'], environment: 'node' } }),
  { coverageFile, include: () => false },
);
