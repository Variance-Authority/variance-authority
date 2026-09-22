/**
 * The same project, recording per-test journeys without a selection snapshot.
 */
import { fileURLToPath } from 'node:url';
import { withJourneyCoverage } from '@variance-authority/sense/jest';

const root = fileURLToPath(new URL('.', import.meta.url));
const journeyFile = process.env['VARIANCE_AUTHORITY_JOURNEYS'];
const cacheDirectory = process.env['VARIANCE_AUTHORITY_JEST_CACHE'];
if (journeyFile === undefined || cacheDirectory === undefined) {
  throw new Error('VARIANCE_AUTHORITY_JOURNEYS and VARIANCE_AUTHORITY_JEST_CACHE are required');
}

export default withJourneyCoverage(
  {
    rootDir: root,
    cacheDirectory,
    testEnvironment: 'node',
    testMatch: ['<rootDir>/test/*.case.ts'],
    transform: {
      '\\.[jt]sx?$': ['@swc/jest', { jsc: { parser: { syntax: 'typescript' } } }],
    },
    setupFiles: ['<rootDir>/test/polyfill.cjs'],
    setupFilesAfterEnv: ['<rootDir>/test/setup.cjs'],
  },
  { journeyFile, preconditions: ['jest.cases.config.mjs'] },
);
