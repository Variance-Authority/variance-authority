import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/jest';

// Two inline projects over one fixture, each with setup and environment files
// of its own: `alpha` loads the polyfill and the setup file, `beta` runs in the
// fixture's environment. Neither project's files govern the other's tests.
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

const transform = { '\\.[jt]sx?$': ['@swc/jest', { jsc: { parser: { syntax: 'typescript' } } }] };

export default withTestSelection(
  {
    rootDir: root,
    projects: [
      {
        displayName: 'alpha',
        rootDir: root,
        cacheDirectory,
        testMatch: ['<rootDir>/test/alpha.case.ts'],
        transform,
        setupFiles: ['<rootDir>/test/polyfill.cjs'],
        setupFilesAfterEnv: ['<rootDir>/test/setup.cjs'],
      },
      {
        displayName: 'beta',
        rootDir: root,
        cacheDirectory,
        testMatch: ['<rootDir>/test/beta.case.ts'],
        transform,
        testEnvironment: '<rootDir>/test/environment.ts',
      },
    ],
  },
  { coverageFile, preconditions: ['jest.projects.config.mjs'], ...selection },
);
