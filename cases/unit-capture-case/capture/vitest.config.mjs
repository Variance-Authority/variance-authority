import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['button.capture.test.mjs'],
    environment: 'node',
  },
});
