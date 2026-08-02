/**
 * A real Storybook, built so the adapter can be pointed at something it did not
 * author. Every other test of `@variance-authority/storybook` runs against
 * fixtures written to match the format; this one runs against the format.
 */
export default {
  stories: ['../src/**/*.stories.@(js|jsx|ts|tsx)'],
  framework: { name: '@storybook/react-vite', options: {} },
  core: { disableTelemetry: true },
  viteFinal: async (config) => ({
    ...config,
    esbuild: {
      ...(config.esbuild ?? {}),
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
    },
  }),
};
