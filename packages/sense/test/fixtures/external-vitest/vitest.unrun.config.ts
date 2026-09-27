import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/vitest';
import { defineConfig } from 'vitest/config';

// Two files, each with a test that runs beside one the runner never starts: a
// todo, and a test behind a closed gate. Their own include, so the files stay
// out of the runs the other configurations here make.
const root = fileURLToPath(new URL('.', import.meta.url));
const source = resolve(root, 'src');
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
if (coverageFile === undefined) throw new Error('VARIANCE_AUTHORITY_COVERAGE is required');

export default withTestSelection(
  defineConfig({
    root,
    test: {
      include: ['test/todo.only.ts', 'test/gated.only.ts'],
      environment: 'node',
      setupFiles: ['test/setup.ts'],
    },
  }),
  {
    coverageFile,
    include: (file) => file.startsWith(source),
  },
);
