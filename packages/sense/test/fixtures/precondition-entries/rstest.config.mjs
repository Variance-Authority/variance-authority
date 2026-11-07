import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/rstest';

const root = fileURLToPath(new URL('.', import.meta.url));
const source = resolve(root, 'src');

export default withTestSelection(
  { root, globals: true, globalSetup: ['./test/global-setup.mjs'], include: ['test/entries.check.ts'] },
  {
    coverageFile: process.env['VARIANCE_AUTHORITY_COVERAGE'],
    include: (file) => file.startsWith(source),
    preconditions: JSON.parse(process.env['FIXTURE_PRECONDITIONS']),
  },
);
