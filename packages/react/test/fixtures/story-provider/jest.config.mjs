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
    testMatch: ['<rootDir>/test/*.dom.tsx'],
    setupFiles: ['@variance-authority/react/story'],
    moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
    transform: {
      '\\.[jt]sx?$': ['@swc/jest', { jsc: { parser: { syntax: 'typescript', tsx: true }, transform: { react: { runtime: 'automatic' } } } }],
    },
  },
  // Workspace packages resolve to their own `dist`, outside `node_modules`;
  // Jest transforms it so `setupFiles` can load its ES modules, and nothing probes it.
  { coverageFile, unprobed: ['../../../../*/dist/**'] },
);
