import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/vitest';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));
const source = resolve(root, 'src');
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
if (coverageFile === undefined) throw new Error('VARIANCE_AUTHORITY_COVERAGE is required');

/**
 * The same fixture with `globals: true` and no imported registrars.
 *
 * Vitest's bracket is `runTask`, so which registrar declared a case cannot
 * reach it — but *cannot* is a claim about the code and this is the run that
 * settles it. Every host is exercised in both spellings, because the placement
 * no configuration takes is the one that records nothing quietly.
 */
export default withTestSelection(
  defineConfig({
    root,
    test: { include: ['test/*.injected.ts'], environment: 'node', globals: true },
  }),
  { coverageFile, cases: true, include: (file) => file.startsWith(source) },
);
