import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/vitest';
import { timeout } from './timeout.js';

// One project of two. Its setup file is named relative to this directory,
// which is where Vitest resolves it, and not to the directory the run started in.
const source = resolve(fileURLToPath(new URL('..', import.meta.url)), 'src');
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
if (coverageFile === undefined) throw new Error('VARIANCE_AUTHORITY_COVERAGE is required');

export default withTestSelection(
  { test: { name: 'dom', include: ['*.case.ts'], setupFiles: ['./setup.ts'], testTimeout: timeout } },
  { coverageFile, include: (file) => file.startsWith(source) },
);
