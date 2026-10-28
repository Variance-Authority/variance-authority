import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const cacheDirectory = process.env['ISOLATOR_JEST_CACHE'];
if (cacheDirectory === undefined) throw new Error('ISOLATOR_JEST_CACHE is required');

export default {
  rootDir: root,
  cacheDirectory,
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/*.case.ts'],
  setupFilesAfterEnv: ['<rootDir>/test/setup.cjs'],
  transform: {
    '\\.[jt]sx?$': [
      '@variance-authority/isolator/jest',
      { root, transformer: ['@swc/jest', { jsc: { parser: { syntax: 'typescript' } } }] },
    ],
  },
};
