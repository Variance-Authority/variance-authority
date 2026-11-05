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
// The cases to skip in the files that run, as JSON of file to names. Absent,
// every file that runs, runs whole.
const cases = process.env['FIXTURE_CASES'];
// What the configuration says about a run with no tests, as JSON. Absent, it
// says nothing.
const passes = process.env['FIXTURE_PASS_WITH_NO_TESTS'];
// The pattern a run with a broken `testMatch` takes. Absent, it finds the cases.
const testMatch = process.env['FIXTURE_TEST_MATCH'] ?? '<rootDir>/test/*.case.ts';
const selection = skip === undefined
  ? {}
  : { selection: async () => ({
    whole: new Set(JSON.parse(skip)),
    skip: new Set(JSON.parse(skip)),
    ...(cases === undefined ? {} : { cases: new Map(Object.entries(JSON.parse(cases))) }),
    notes: [],
  }) };

export default withTestSelection(
  {
    rootDir: root,
    cacheDirectory,
    testEnvironment: '<rootDir>/test/environment.ts',
    testTimeout: 4321,
    ...(passes === undefined ? {} : { passWithNoTests: JSON.parse(passes) }),
    testMatch: [testMatch],
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
  {
    coverageFile,
    preconditions: ['jest.config.mjs'],
    // The recipe, when the test that runs this fixture names one.
    ...(process.env['FIXTURE_MODE'] === undefined ? {} : { mode: process.env['FIXTURE_MODE'] }),
    ...selection,
  },
);
