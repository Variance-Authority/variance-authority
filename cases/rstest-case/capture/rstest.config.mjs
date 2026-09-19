import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['button.capture.test.mjs'],
  globalSetup: ['./reset.mjs'],
  testEnvironment: 'jsdom',
});
