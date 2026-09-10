import { dirname, resolve } from 'node:path';
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
    testEnvironment: 'node',
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
  { coverageFile, preconditions: ['jest.config.mjs'] },
);
