import config from './jest.config.mjs';

// `jest.config.mjs` with a recorder that loses a module: what the registry
// check is there to catch, for a test that holds a file to it.
export default {
  ...config,
  setupFilesAfterEnv: [...config.setupFilesAfterEnv, '<rootDir>/test/drops-a-module.cjs'],
};
