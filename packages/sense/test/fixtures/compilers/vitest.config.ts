import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/vitest';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// Required by Node rather than bundled into the config, so `magic-string`
// loads as the CommonJS it ships for `require`.
const extractor = createRequire(import.meta.url)('./extract.cjs') as typeof import('./extract.cjs');

const root = fileURLToPath(new URL('.', import.meta.url));
const source = resolve(root, 'src');
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
if (coverageFile === undefined) throw new Error('VARIANCE_AUTHORITY_COVERAGE is required');
// Where the probes go: after the project's transforms unless the test asks for before.
const placement = process.env['VARIANCE_AUTHORITY_PLACEMENT'] as 'after-transforms' | 'before-transforms' | undefined;

// After Vite's TypeScript transform, as a project's normal plugin runs.
const extract: Plugin = {
  name: 'extract',
  transform: (code, id) => (id.endsWith('.ts') ? (extractor.extract(code, id) ?? null) : null),
};

export default withTestSelection(
  defineConfig({ root, plugins: [extract], test: { include: ['test/*.case.ts'], globals: true } }),
  { coverageFile, include: (file) => file.startsWith(source), ...(placement === undefined ? {} : { placement }) },
);
