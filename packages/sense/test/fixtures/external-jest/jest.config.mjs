import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/jest';

const root = fileURLToPath(new URL('.', import.meta.url));
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
const cacheDirectory = process.env['VARIANCE_AUTHORITY_JEST_CACHE'];
if (coverageFile === undefined || cacheDirectory === undefined) {
  throw new Error('VARIANCE_AUTHORITY_COVERAGE and VARIANCE_AUTHORITY_JEST_CACHE are required');
}
// A selection handed in by the test that runs this fixture: the files to skip,
// as JSON. Absent, nothing is handed in and every file runs.
const skip = process.env['FIXTURE_SKIP'];
const selection = skip === undefined
  ? {}
  : { selection: async () => ({ whole: new Set(JSON.parse(skip)), skip: new Set(JSON.parse(skip)), notes: [] }) };

export default withTestSelection(
  {
    rootDir: root,
    cacheDirectory,
    testEnvironment: '<rootDir>/test/environment.ts',
    testMatch: ['<rootDir>/test/*.case.ts'],
    transform: {
      '\\.[jt]sx?$': ['@swc/jest', { jsc: { parser: { syntax: 'typescript' } } }],
    },
    setupFiles: ['<rootDir>/test/polyfill.cjs'],
    setupFilesAfterEnv: ['<rootDir>/test/setup.cjs'],
    reporters: [
      'default',
      ['<rootDir>/test/reporter.cjs', { mark: resolve(dirname(coverageFile), 'user-reporter.txt') }],
    ],
  },
  { coverageFile, preconditions: ['jest.config.mjs'], ...selection },
);
