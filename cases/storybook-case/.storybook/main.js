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
    },
    esbuild: {
      ...config.esbuild,
      // Stated rather than inherited. Without it the stories compile against the
      // classic JSX runtime and every one of them throws `React is not defined` —
      // which the adapter reports correctly, and which would still be a case
      // about this file rather than about the adapter.
      jsx: 'automatic',
      /**
       * **The line component attribution does not work without.**
       *
       * A production Storybook build minifies, and minification renames
       * functions. React reads a component's display name off the function, so
       * `Button` becomes `a` — and the whole chain still works, still finds the
       * right regions, still resolves them to the right boxes, and reports
       * `1356 pixel(s) differ ... in a`. Which is worse than reporting nothing,
       * because it is a complete, confident answer naming something that appears
       * nowhere in the source.
       *
       * Found by the first real `variance run` against this Storybook and by
       * nothing before it: every other subject in this repository is built by
       * esbuild in development mode, where names survive by default.
       *
       * The cost is a slightly larger bundle in a build nobody ships. Any
       * project wanting component names in its reports pays the same, and it is
       * not a thing anybody would guess.
       */
      keepNames: true,
      /**
       * **The setting the plugin above cannot supply for itself.**
       *
       * `jsxDev` is what makes the transform emit each element's file, line and
       * column at all. Without it there is no location for anything to keep, and
       * with it there is one even here — this is a production build, and the
       * locations survive minification because they are data the compiler wrote
       * rather than names a bundler could rename. `keepNames` above is the
       * opposite kind of setting for exactly that reason.
       *
       * React 19 is what drops them: its `jsxDEV` takes four parameters and
       * overwrites the transform's fifth argument with an `Error` of its own, and
       * `createElement` skips `__source` by name. The plugin puts a runtime in
       * React's place that records the argument before handing it on.
       *
       * What this buys, visible in `cli.chromium.test.js`: a finding names the
       * element's own line rather than the line its component is declared on.
       */
      jsxDev: true,
    },
  }),
};
