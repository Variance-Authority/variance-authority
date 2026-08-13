'use strict';

/**
 * Installing the recording runtime under Jest.
 *
 * Jest has no plugin that can answer a module request, so the swap happens in a
 * resolver. It does the same thing `./src/vite.ts` does — makes
 * `react/jsx-dev-runtime` resolve to this package's runtime — and it has to be
 * written here, in CommonJS, because Jest loads a resolver synchronously.
 *
 * ```js
 * // jest.config.js
 * export default {
 *   resolver: '@variance-authority/jsx-source/jest-resolver',
 *   transformIgnorePatterns: ['/node_modules/(?!@variance-authority/)'],
 * };
 * ```
 *
 * The second line is the ordinary accommodation Jest needs for a package that
 * ships ES modules: without it Jest declines to transform this one and then
 * cannot `require` it. It is not specific to what this resolver does.
 *
 * `moduleNameMapper` looks like it would be enough and is not. It rewrites every
 * request, including the recording runtime's own request for the runtime it
 * records for, which resolves it back to itself. A resolver can see who is
 * asking; a mapping cannot.
 */

const { dirname } = require('node:path');

/** The specifier every JSX runtime bottoms out in. */
const REACT_DEV_RUNTIME = 'react/jsx-dev-runtime';

const RECORDING_RUNTIME = require.resolve('./dist/jsx-dev-runtime.js');

/** Where the recording runtime asks from, and therefore where not to answer. */
const RECORDING_DIR = dirname(RECORDING_RUNTIME);

module.exports = function resolve(request, options) {
  if (request === REACT_DEV_RUNTIME && options.basedir !== RECORDING_DIR) {
    return RECORDING_RUNTIME;
  }

  return options.defaultResolver(request, options);
};
