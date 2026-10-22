import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/jest';

const root = fileURLToPath(new URL('.', import.meta.url));
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
// Where the probes go: after the project's transforms unless the test asks for before.
const placement = process.env['VARIANCE_AUTHORITY_PLACEMENT'];
const cacheDirectory = process.env['VARIANCE_AUTHORITY_JEST_CACHE'];
if (coverageFile === undefined || cacheDirectory === undefined) {
  throw new Error('VARIANCE_AUTHORITY_COVERAGE and VARIANCE_AUTHORITY_JEST_CACHE are required');
}

export default withTestSelection(
  {
    rootDir: root,
    cacheDirectory,
    testEnvironment: 'node',
    testMatch: ['<rootDir>/test/*.case.ts'],
    transform: { '\\.[jt]sx?$': fileURLToPath(new URL('./extract-jest.cjs', import.meta.url)) },
  },
  { coverageFile, ...(placement === undefined ? {} : { placement }) },
);
