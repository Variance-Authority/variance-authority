/**
 * The review surface, one component at a time.
 *
 * Built so the gate in `.github/workflows/variance.yml` can photograph it: a
 * change to `src/ui` that moves no pixel here moved no pixel a reviewer sees.
 * The stories import the components from `src/`, not from `dist/`, and the
 * build keeps what attribution reads — names through minification, each
 * element's `file:line` from `jsxSource()`, and the source maps — so a changed
 * region is named for the tribunal component that drew it.
 */
import type { StorybookConfig } from '@storybook/react-vite';
import { jsxSource } from '@variance-authority/jsx-source/vite';

const config: StorybookConfig = {
  stories: ['../stories/**/*.stories.tsx'],
  framework: { name: '@storybook/react-vite', options: {} },
  core: { disableTelemetry: true },
  // The images the recording holds, served beside the stories that show them.
  staticDirs: [{ from: '../stories/recorded/images', to: '/recorded' }],
  viteFinal: async (config) => ({
    ...config,
    plugins: [...(config.plugins ?? []), jsxSource()],
    build: { ...config.build, sourcemap: true },
    esbuild: { ...config.esbuild, jsx: 'automatic', keepNames: true, jsxDev: true },
  }),
};

export default config;
