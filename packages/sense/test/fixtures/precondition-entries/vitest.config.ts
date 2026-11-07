import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/vitest';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));
const source = resolve(root, 'src');
const cut = process.env['FIXTURE_CUT'];
const selection = cut === undefined ? {} : {
  selection: async () => ({ whole: new Set<string>(), skip: new Set<string>(), cases: new Map([[cut, ['no such case']]]), notes: [] }),
};

export default withTestSelection(
  defineConfig({
    root,
    test: { globals: true, globalSetup: ['test/global-setup.mjs'], include: ['test/entries.check.ts'] },
  }),
  {
    coverageFile: process.env['VARIANCE_AUTHORITY_COVERAGE']!,
    include: (file) => file.startsWith(source),
    preconditions: JSON.parse(process.env['FIXTURE_PRECONDITIONS']!),
    ...selection,
  },
);
