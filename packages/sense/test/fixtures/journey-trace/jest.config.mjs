/**
 * A Jest project whose cases call a service that calls another. Nothing of ours
 * crosses either gap: the application's tracing carries the trace it always
 * carries, and each case runs inside a trace whose id is its journey.
 */
import { fileURLToPath } from 'node:url';
import { withJourneyCoverage } from '@variance-authority/sense/jest';

const root = fileURLToPath(new URL('.', import.meta.url));
const journeyFile = process.env['VARIANCE_AUTHORITY_JOURNEYS'];
const cacheDirectory = process.env['VARIANCE_AUTHORITY_JEST_CACHE'];
const parts = process.env['VARIANCE_AUTHORITY_PARTS'];
const tracer = process.env['TRACER'];
if (journeyFile === undefined || cacheDirectory === undefined || parts === undefined || tracer === undefined) {
  throw new Error('VARIANCE_AUTHORITY_JOURNEYS, _JEST_CACHE, _PARTS and TRACER are required');
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
  {
    journeyFile,
    parts: [parts],
    preconditions: ['jest.config.mjs'],
    // The application's tracing, initialized once per worker as it would be
    // for any test, and told to carry each case's journey.
    trace: `./${tracer}/case.cjs`,
  },
);
