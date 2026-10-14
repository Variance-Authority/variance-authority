import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/vitest';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import extractor from './extract.cjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const source = resolve(root, 'src');
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
if (coverageFile === undefined) throw new Error('VARIANCE_AUTHORITY_COVERAGE is required');

// After Vite's TypeScript transform, as a project's normal plugin runs.
const extract: Plugin = {
  name: 'extract',
  transform: (code, id) => (id.endsWith('.ts') ? { code: extractor.extract(code), map: null } : null),
};

export default withTestSelection(
  defineConfig({ root, plugins: [extract], test: { include: ['test/*.case.ts'], globals: true } }),
  { coverageFile, include: (file) => file.startsWith(source) },
);
