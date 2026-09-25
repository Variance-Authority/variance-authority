/**
 * A Jest project whose cases call a service in another process. The only thing
 * crossing the gap is an HTTP request with the case's journey on it; what the
 * service ran comes back as parts, after the run.
 */
import { fileURLToPath } from 'node:url';
import { withJourneyCoverage } from '@variance-authority/sense/jest';

const root = fileURLToPath(new URL('.', import.meta.url));
const journeyFile = process.env['VARIANCE_AUTHORITY_JOURNEYS'];
const cacheDirectory = process.env['VARIANCE_AUTHORITY_JEST_CACHE'];
const parts = process.env['VARIANCE_AUTHORITY_PARTS'];
const head = process.env['VARIANCE_AUTHORITY_HEAD'];
if (journeyFile === undefined || cacheDirectory === undefined || parts === undefined || head === undefined) {
  throw new Error('VARIANCE_AUTHORITY_JOURNEYS, _JEST_CACHE, _PARTS and _HEAD are required');
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
  },
  { journeyFile, parts: [parts], heads: [head], preconditions: ['jest.config.mjs'] },
);
