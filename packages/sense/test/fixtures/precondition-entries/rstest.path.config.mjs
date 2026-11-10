import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/rstest';

// Rstest loads the project from its own file, so no plugin of the seam reaches it.
const root = fileURLToPath(new URL('.', import.meta.url));
const source = resolve(root, 'src');

export default withTestSelection(
  { root, projects: ['./rstest.unwrapped.config.mjs'] },
  {
    coverageFile: process.env['VARIANCE_AUTHORITY_COVERAGE'],
    include: (file) => file.startsWith(source),
    preconditions: JSON.parse(process.env['FIXTURE_PRECONDITIONS']),
  },
);
