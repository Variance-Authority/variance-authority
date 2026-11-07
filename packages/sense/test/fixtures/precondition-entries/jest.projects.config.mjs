import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/jest';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const project = (displayName) => ({
  displayName,
  rootDir,
  testMatch: ['<rootDir>/test/entries.check.ts'],
  transform: { '\\.[jt]sx?$': ['@swc/jest', { jsc: { parser: { syntax: 'typescript' } } }] },
});

export default withTestSelection(
  { rootDir, cacheDirectory: process.env['VARIANCE_AUTHORITY_JEST_CACHE'], projects: [project('one'), project('two')] },
  { coverageFile: process.env['VARIANCE_AUTHORITY_COVERAGE'], preconditions: JSON.parse(process.env['FIXTURE_PRECONDITIONS']) },
);
