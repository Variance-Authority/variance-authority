import { defineConfig } from 'vitest/config';
import { withTestSelection } from '../packages/sense/dist/test-selection/vitest.js';

/** Product code only. A probe in a test file records the test observing itself. */
const PRODUCT = /[/\\]packages[/\\][^/\\]+[/\\]src[/\\].*\.[cm]?[jt]sx?$/;
const TEST = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

/** The repository suite using the same integration an external Vitest project uses. */
export default withTestSelection(
  defineConfig({
    test: {
      include: [
        'packages/*/src/**/*.test.{ts,tsx}',
        'packages/*/test/**/*.test.ts',
        'examples/*/src/**/*.test.{ts,tsx}',
        'cases/*/src/**/*.test.{js,ts,tsx}',
      ],
      environment: 'node',
    },
    esbuild: { jsx: 'automatic' },
  }),
  { include: (file) => PRODUCT.test(file) && !TEST.test(file) },
);
