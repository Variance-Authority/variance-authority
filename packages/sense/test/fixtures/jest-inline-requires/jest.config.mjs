import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/jest';

const root = fileURLToPath(new URL('.', import.meta.url));
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
const cacheDirectory = process.env['VARIANCE_AUTHORITY_JEST_CACHE'];
if (coverageFile === undefined || cacheDirectory === undefined) {
  throw new Error('VARIANCE_AUTHORITY_COVERAGE and VARIANCE_AUTHORITY_JEST_CACHE are required');
}
// React Native's inline requires, as SWC spells them: each listed import is
// required where it is first read, not where it is written.
const inline = process.env['VARIANCE_AUTHORITY_INLINE_REQUIRES'] === '1';

export default withTestSelection(
  {
    rootDir: root,
    cacheDirectory,
    testEnvironment: 'node',
    testMatch: ['<rootDir>/test/*.case.ts'],
    transform: {
      '\\.[jt]sx?$': [
        '@swc/jest',
        {
          jsc: { parser: { syntax: 'typescript' } },
          ...(inline ? { module: { type: 'commonjs', lazy: ['../src/greet', './with-logging'] } } : {}),
        },
      ],
    },
  },
  { coverageFile, preconditions: ['jest.config.mjs'] },
);
