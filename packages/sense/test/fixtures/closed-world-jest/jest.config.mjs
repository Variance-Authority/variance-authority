import { withTestSelection } from '@variance-authority/sense/jest';

// A project set up as people set Jest up: a mapper for styles and a path alias,
// a `__mocks__` file beside a module and one under the root for a package,
// factory mocks around the original, isolated registries, and a setup file
// that loads a module no test imports.
//
// `FIXTURE_AUTOMOCK` turns automock on.
const root = new URL('.', import.meta.url).pathname;
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
const cacheDirectory = process.env['VARIANCE_AUTHORITY_JEST_CACHE'];
if (coverageFile === undefined || cacheDirectory === undefined) {
  throw new Error('VARIANCE_AUTHORITY_COVERAGE and VARIANCE_AUTHORITY_JEST_CACHE are required');
}

export default withTestSelection(
  {
    rootDir: root,
    cacheDirectory,
    testMatch: ['<rootDir>/test/*.case.ts'],
    transform: { '\\.[jt]sx?$': ['@swc/jest', { jsc: { parser: { syntax: 'typescript' } } }] },
    moduleNameMapper: {
      '\\.css$': '<rootDir>/styles/stub.cjs',
      '^@app/(.*)$': '<rootDir>/src/$1',
    },
    setupFiles: ['<rootDir>/test/setup.ts'],
    automock: process.env['FIXTURE_AUTOMOCK'] === 'on',
    unmockedModulePathPatterns: ['<rootDir>/styles/', '<rootDir>/test/'],
  },
  { coverageFile },
);
