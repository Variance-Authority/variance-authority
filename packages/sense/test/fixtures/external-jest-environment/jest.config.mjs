import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/jest';
export default withTestSelection({
  rootDir: fileURLToPath(new URL('.', import.meta.url)),
  cacheDirectory: process.env.FIXTURE_CACHE,
  testEnvironment: process.env.FIXTURE_ENVIRONMENT ?? '<rootDir>/environment.ts',
  testMatch: ['<rootDir>/test/*.case.js'],
  transformIgnorePatterns: ['/node_modules/', '<rootDir>/native/'],
  transform: { '\\.[jt]s$': ['@swc/jest', { jsc: { parser: { syntax: 'typescript' } } }] },
}, { coverageFile: process.env.FIXTURE_COVERAGE });
