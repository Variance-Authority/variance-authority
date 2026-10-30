import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/vitest';

// The configuration that describes the run, and lists its two projects over
// the one test file.
const root = fileURLToPath(new URL('.', import.meta.url));
const source = resolve(root, 'src');
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
if (coverageFile === undefined) throw new Error('VARIANCE_AUTHORITY_COVERAGE is required');

export default withTestSelection({ root, test: { projects: ['vitest.plain.config.ts', 'vitest.compiled.config.ts'] } }, { coverageFile, include: (file) => file.startsWith(source) });
