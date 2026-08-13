import { fileURLToPath } from 'node:url';

/**
 * Installing the recording runtime without taking `jsxImportSource`.
 *
 * The plugin does one thing: it makes `react/jsx-dev-runtime` resolve to this
 * package's runtime instead of React's. Everything layered above — Emotion,
 * theme-ui, a house runtime, or nothing at all — keeps resolving exactly where it
 * did, keeps being imported by the same compiler setting, and keeps working. What
 * changes is the bottom of the chain, which is the only place the transform's
 * source argument was being dropped.
 *
 * Vite is three build tools for the price of one here: the same plugin serves a
 * Vite application, Storybook's React builder, and Vitest.
 *
 * Types are declared structurally rather than imported. A plugin object is a
 * plain object, and this package should not make a consumer install Vite to
 * compile against it.
 */

/** The specifier every JSX runtime bottoms out in. */
const REACT_DEV_RUNTIME = 'react/jsx-dev-runtime';

/**
 * This package's replacement for it, as an absolute path.
 *
 * Absolute rather than a bare specifier because the answer is also the guard: a
 * module that resolves to this path is the runtime itself, and its own import of
 * React must be left alone or it resolves back into itself.
 */
const RECORDING_RUNTIME = fileURLToPath(new URL('./jsx-dev-runtime.js', import.meta.url));

/** The shape of the resolution hook, without depending on Vite for it. */
export interface JsxSourcePlugin {
  readonly name: string;
  readonly enforce: 'pre';
  resolveId(id: string, importer?: string | undefined): string | null;
}

/**
 * Record the source location of every element, alongside any custom JSX runtime.
 *
 * ```js
 * import { jsxSource } from '@variance-authority/jsx-source/vite';
 *
 * export default { plugins: [jsxSource()], esbuild: { jsxDev: true } };
 * ```
 *
 * `jsxDev` is the setting that matters and is not implied by this plugin: it is
 * what makes the transform compute a location in the first place. It is worth
 * turning on for a production build too, because a location is data the compiler
 * emitted rather than a name minification could rename.
 */
export function jsxSource(): JsxSourcePlugin {
  return {
    name: '@variance-authority/jsx-source',

    /**
     * Ahead of Vite's own resolver, which would otherwise answer for React
     * first and never give this plugin the specifier.
     */
    enforce: 'pre',

    resolveId(id, importer) {
      if (id !== REACT_DEV_RUNTIME) return null;

      // The recording runtime importing the runtime it records for. Answering
      // here would hand it itself.
      if (importer === RECORDING_RUNTIME) return null;

      return RECORDING_RUNTIME;
    },
  };
}
