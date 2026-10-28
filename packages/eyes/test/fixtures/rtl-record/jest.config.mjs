import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/jest';

const root = fileURLToPath(new URL('.', import.meta.url));
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
const cacheDirectory = process.env['VARIANCE_AUTHORITY_JEST_CACHE'];
if (coverageFile === undefined || cacheDirectory === undefined) {
  throw new Error('VARIANCE_AUTHORITY_COVERAGE and VARIANCE_AUTHORITY_JEST_CACHE are required');
}

export default withTestSelection(
  {
    rootDir: root,
    cacheDirectory,
    injectGlobals: true,
    testEnvironment: '<rootDir>/environment.cjs',
    // `retry` is Vitest's option, so the retried case is Vitest's alone.
    testMatch: ['<rootDir>/test/remove.case.js'],
    transform: { '\\.[jt]sx?$': ['@swc/jest', {}] },
  },
  { coverageFile },
);
