import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/jest';

const root = fileURLToPath(new URL('.', import.meta.url));
// Named by a test that reads the record itself; else the repository's integration suite's.
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
const cacheDirectory = process.env['VARIANCE_AUTHORITY_JEST_CACHE'];

export default withTestSelection(
  {
    rootDir: root,
    ...(cacheDirectory === undefined ? {} : { cacheDirectory }),
    testMatch: ['<rootDir>/test/*.case.js'],
  },
  coverageFile === undefined ? { suite: 'integration' } : { coverageFile },
);
