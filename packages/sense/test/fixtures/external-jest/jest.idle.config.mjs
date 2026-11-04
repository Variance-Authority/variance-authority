import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/jest';

const root = fileURLToPath(new URL('.', import.meta.url));
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
const cacheDirectory = process.env['VARIANCE_AUTHORITY_JEST_CACHE'];
if (coverageFile === undefined || cacheDirectory === undefined) {
  throw new Error('VARIANCE_AUTHORITY_COVERAGE and VARIANCE_AUTHORITY_JEST_CACHE are required');
}

// A run that instruments no module: its one test imports no source, and nothing
// around it does.
export default withTestSelection(
  {
    rootDir: root,
    cacheDirectory,
    testEnvironment: 'node',
    testMatch: ['<rootDir>/test/plain.idle.ts'],
    transform: { '\\.[jt]sx?$': ['@swc/jest', { jsc: { parser: { syntax: 'typescript' } } }] },
  },
  { coverageFile },
);
