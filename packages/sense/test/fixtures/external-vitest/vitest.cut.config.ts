import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/vitest';
import { defineConfig } from 'vitest/config';

// Files whose run the runner cuts on its own: a name filter, or a cancel. The
// command line names which of them a run takes. Two workers, because the cancel
// has to reach one file while another is failing.
const root = fileURLToPath(new URL('.', import.meta.url));
const source = resolve(root, 'src');
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
if (coverageFile === undefined) throw new Error('VARIANCE_AUTHORITY_COVERAGE is required');

export default withTestSelection(
  defineConfig({
    root,
    test: {
      include: ['test/*.cut.ts'],
      environment: 'node',
      setupFiles: ['test/setup.ts'],
      minWorkers: 2,
      maxWorkers: 2,
    },
  }),
  {
    coverageFile,
    include: (file) => file.startsWith(source),
  },
);
