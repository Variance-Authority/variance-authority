import { fileURLToPath } from 'node:url';

// `jest.config.mjs` without the seam: what Jest does on its own, for a test
// that holds a wrapped run to it.
const root = fileURLToPath(new URL('.', import.meta.url));
const cacheDirectory = process.env['VARIANCE_AUTHORITY_JEST_CACHE'];
if (cacheDirectory === undefined) throw new Error('VARIANCE_AUTHORITY_JEST_CACHE is required');

export default {
  rootDir: root,
  cacheDirectory,
  testEnvironment: '<rootDir>/test/environment.ts',
  testMatch: ['<rootDir>/test/*.case.ts'],
  transform: {
    '\\.[jt]sx?$': ['@swc/jest', { jsc: { parser: { syntax: 'typescript' } } }],
  },
  setupFiles: ['<rootDir>/test/polyfill.cjs'],
  setupFilesAfterEnv: ['<rootDir>/test/setup.cjs'],
};
