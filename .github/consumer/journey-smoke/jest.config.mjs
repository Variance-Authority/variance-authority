import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { withJourneyCoverage } from '@variance-authority/sense/jest';

const root = fileURLToPath(new URL('.', import.meta.url));

export default withJourneyCoverage(
  {
    rootDir: root,
    cacheDirectory: resolve(root, '.cache/jest'),
    testEnvironment: 'node',
    testMatch: ['<rootDir>/test/*.test.js'],
    transform: {},
  },
  { journeyFile: resolve(root, '.artifacts/journeys.bin') },
);

