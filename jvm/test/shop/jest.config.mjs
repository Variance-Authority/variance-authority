// Jest cases that call the shop over HTTP. The shop is a JVM in another
// process; what it ran comes back as parts in VARIANCE_AUTHORITY_PARTS after it
// exits, and the fold joins them to these cases by journey alone.
import { fileURLToPath } from 'node:url';
import { withJourneyCoverage } from '@variance-authority/sense/jest';

const root = fileURLToPath(new URL('.', import.meta.url));
const journeyFile = process.env['VARIANCE_AUTHORITY_JOURNEYS'];
const cacheDirectory = process.env['VARIANCE_AUTHORITY_JEST_CACHE'];
const parts = process.env['VARIANCE_AUTHORITY_PARTS'];
if (journeyFile === undefined || cacheDirectory === undefined || parts === undefined) {
  throw new Error('VARIANCE_AUTHORITY_JOURNEYS, _JEST_CACHE and _PARTS are required');
}

export default withJourneyCoverage(
  {
    rootDir: root,
    cacheDirectory,
    testEnvironment: 'node',
    testMatch: ['<rootDir>/jest/*.case.ts'],
    transform: {
      '\\.[jt]sx?$': ['@swc/jest', { jsc: { parser: { syntax: 'typescript' } } }],
    },
  },
  { journeyFile, parts: [parts] },
);
