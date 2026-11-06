/**
 * A real Storybook, built so the adapter can be pointed at something it did not
 * author. Every other test of `@variance-authority/storybook` runs against
 * fixtures written to match the format; this one runs against the format.
 */
import { jsxSource } from '@variance-authority/jsx-source/vite';

export default {
  stories: ['../src/**/*.stories.@(js|jsx|ts|tsx)'],
  framework: { name: '@storybook/react-vite', options: {} },
  core: { disableTelemetry: true },
  viteFinal: async (config) => ({
    ...config,
    /**
     * **The plugin that turns a rendered node back into a line of code.**
     *
     * It makes `react/jsx-dev-runtime` resolve to a runtime that keeps the
     * location instead of dropping it, which is a thing this file can do without
     * spending `jsxImportSource` — one setting, of which a project has exactly
     * one, and which a project using Emotion or theme-ui has already spent.
     * Nothing else about the build changes and nothing above React notices.
     */
    plugins: [...(config.plugins ?? []), jsxSource()],
    build: {
      ...config.build,
      /**
       * **What the engine half of the source index costs.**
       *
       * Asking the browser where a component was compiled from answers with a
       * position in a served bundle, and a served position is a position in this
       * repository only if a map says so — an unmapped one is refused rather
       * than reported as a file nobody can open. A production Storybook build
       * emits no maps by default, so without this line the run's own page can
       * name a component it has rendered and still not say where it came from,
       * and the scan's guess is all that is left.
       */
      sourcemap: true,
      rolldownOptions: {
        ...config.build?.rolldownOptions,
        output: {
          ...config.build?.rolldownOptions?.output,
          /**
           * **The line component attribution does not work without.**
           *
           * A production build minifies, and React reads a component's name off
           * the function, so `Button` reports as `a`: a confident answer naming
           * nothing in the source. It costs a slightly larger bundle.
           */
          keepNames: true,
        },
      },
    },
    oxc: {
      ...config.oxc,
      jsx: {
        // Stated rather than inherited. Without it the stories compile against
        // the classic JSX runtime and every one of them throws `React is not
        // defined` — which the adapter reports correctly, and which would still
        // be a case about this file rather than about the adapter.
        runtime: 'automatic',
        /**
         * **The setting the plugin above cannot supply for itself.**
         *
         * It emits each element's file, line and column, data that survives
         * minification. React 19 drops that argument, so the plugin's runtime
         * records it first, and a finding in `cli.chromium.test.js` names the
         * element's own line.
         */
        development: true,
      },
    },
  }),
};
