import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/jest';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default withTestSelection(
  {
    rootDir,
    cacheDirectory: process.env['VARIANCE_AUTHORITY_JEST_CACHE'],
    globalSetup: '<rootDir>/test/global-setup.mjs',
    testMatch: ['<rootDir>/test/entries.check.ts'],
    transform: { '\\.[jt]sx?$': ['@swc/jest', { jsc: { parser: { syntax: 'typescript' } } }] },
  },
  { coverageFile: process.env['VARIANCE_AUTHORITY_COVERAGE'], preconditions: JSON.parse(process.env['FIXTURE_PRECONDITIONS']) },
);
