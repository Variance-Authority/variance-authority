// The application build carries the probes; nothing in the stories knows.
import { testSelectionProbes } from '@variance-authority/sense/journal';

export default {
  stories: ['../src/**/*.stories.jsx'],
  framework: { name: '@storybook/react-vite', options: {} },
  core: { disableTelemetry: true },
  viteFinal: async (config) => ({
    ...config,
    plugins: [
      ...(config.plugins ?? []),
      testSelectionProbes({
        label: 'storybook',
        include: (file) => file.includes('/cases/playwright-storybook-case/src/'),
      }),
    ],
    esbuild: { ...config.esbuild, jsx: 'automatic' },
  }),
};
