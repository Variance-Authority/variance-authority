/**
 * A real Storybook, built so the adapter can be pointed at something it did not
 * author. Every other test of `@variance-authority/storybook` runs against
 * fixtures written to match the format; this one runs against the format.
 */
export default {
  stories: ['../src/**/*.stories.@(js|jsx|ts|tsx)'],
  framework: { name: '@storybook/react-vite', options: {} },
  core: { disableTelemetry: true },
  // Stated rather than inherited. Without it the stories compile against the
  // classic JSX runtime and every one of them throws `React is not defined` —
  // which the adapter reports correctly, and which would still be a case about
  // this file rather than about the adapter.
  viteFinal: async (config) => ({
    ...config,
    esbuild: { ...(config.esbuild ?? {}), jsx: 'automatic' },
  }),
};
