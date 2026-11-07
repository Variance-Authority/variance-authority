import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/jest';
if (process.env.FIXTURE_IMPORTED_JSON !== undefined) await import('./src/imported-settings.json', { with: { type: 'json' } });
export default withTestSelection({
  rootDir: fileURLToPath(new URL('.', import.meta.url)),
  cacheDirectory: process.env.FIXTURE_CACHE,
  testEnvironment: process.env.FIXTURE_ENVIRONMENT ?? '<rootDir>/environment.ts',
  testMatch: [process.env.FIXTURE_MATCH ?? '<rootDir>/test/*.case.js'],
  ...(process.env.FIXTURE_RUNTIME === undefined ? {} : { runtime: process.env.FIXTURE_RUNTIME }),
  ...(process.env.FIXTURE_PRESET === undefined ? {} : { preset: process.env.FIXTURE_PRESET }),
  ...(process.env.FIXTURE_RESOLVER === undefined ? {} : { resolver: process.env.FIXTURE_RESOLVER }),
  transformIgnorePatterns: ['/node_modules/', '<rootDir>/native/'],
  ...(process.env.FIXTURE_DEFAULT_TRANSFORM === undefined ? { transform: { '\\.[jt]s$': ['@swc/jest', { jsc: { parser: { syntax: 'typescript' } } }] } } : {}),
}, { coverageFile: process.env.FIXTURE_COVERAGE });
