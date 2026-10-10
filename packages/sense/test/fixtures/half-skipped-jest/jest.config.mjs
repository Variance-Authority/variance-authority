import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/jest';

// Two projects over the one test file, and the second skips every test in it:
// that project's sandbox runs no `afterAll` and writes no journal, while the
// first project's journal names the same path.
const root = fileURLToPath(new URL('.', import.meta.url));
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
const cacheDirectory = process.env['VARIANCE_AUTHORITY_JEST_CACHE'];
if (coverageFile === undefined || cacheDirectory === undefined) {
  throw new Error('VARIANCE_AUTHORITY_COVERAGE and VARIANCE_AUTHORITY_JEST_CACHE are required');
}

const project = (displayName, skipsEverything) => ({
  displayName,
  rootDir: root,
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/*.case.ts'],
  globals: { skipsEverything },
  transform: {
    '\\.[jt]sx?$': ['@swc/jest', { jsc: { parser: { syntax: 'typescript' } } }],
  },
});

export default withTestSelection(
  { rootDir: root, cacheDirectory, projects: [project('runs', false), project('skips', true)] },
  { coverageFile },
);
