import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/jest';
export default withTestSelection({
  rootDir: fileURLToPath(new URL('.', import.meta.url)),
  cacheDirectory: process.env.FIXTURE_CACHE,
  preset: '<rootDir>/preset.cjs',
  testMatch: ['<rootDir>/test/*.case.ts'],
  ...(process.env.FIXTURE_TRANSFORM === undefined ? {} : { transform: JSON.parse(process.env.FIXTURE_TRANSFORM) }),
}, { coverageFile: process.env.FIXTURE_COVERAGE });
