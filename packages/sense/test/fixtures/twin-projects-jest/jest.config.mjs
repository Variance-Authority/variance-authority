import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/jest';

// Two projects over the one test file, as a library runs its suite once as
// written and once compiled. Each one's `rootDir` is the fixture, so the case
// is the same file in both.
const root = fileURLToPath(new URL('.', import.meta.url));
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
const cacheDirectory = process.env['VARIANCE_AUTHORITY_JEST_CACHE'];
if (coverageFile === undefined || cacheDirectory === undefined) {
  throw new Error('VARIANCE_AUTHORITY_COVERAGE and VARIANCE_AUTHORITY_JEST_CACHE are required');
}

const project = (displayName) => ({
  displayName,
  rootDir: root,
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/*.case.ts'],
  transform: {
    '\\.[jt]sx?$': ['@swc/jest', { jsc: { parser: { syntax: 'typescript' } } }],
  },
});

export default withTestSelection(
  { rootDir: root, cacheDirectory, projects: [project('plain'), project({ name: 'compiled', color: 'blue' })] },
  { coverageFile },
);
