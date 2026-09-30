import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/vitest';
import { defineConfig } from 'vitest/config';

// A typecheck the runner cannot start: the checker is a command nobody has, so
// Vitest rejects before any file runs and exits with no reporter hook called
// and no server closed. The compiler settings it copies sit in a directory the
// test owns, because Vitest writes its own temporary file beside them and
// leaves that behind too.
const root = fileURLToPath(new URL('.', import.meta.url));
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
const tsconfig = process.env['CUT_TSCONFIG'];
if (coverageFile === undefined || tsconfig === undefined) {
  throw new Error('VARIANCE_AUTHORITY_COVERAGE and CUT_TSCONFIG are required');
}

export default withTestSelection(
  defineConfig({
    root,
    test: {
      include: ['test/todo.only.ts'],
      environment: 'node',
      typecheck: {
        enabled: true,
        only: true,
        include: ['test/todo.only.ts'],
        checker: 'variance-authority-no-such-checker',
        tsconfig,
      },
    },
  }),
  { coverageFile },
);
