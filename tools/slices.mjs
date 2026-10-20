/**
 * Where the suite's tests live, and which slice a file is in: read by
 * `vitest.config.mts`, which runs them, and by `tools/test-loop.mjs`, which asks
 * whether a new file is a test before starting a runner for it.
 */

import picomatch from 'picomatch';

/**
 * Where tests live. A slice is these places narrowed by a marker in the file
 * name, so a file says which slice it is in and no list has to.
 */
export const PLACES = [
  'site/app/**/*.test.{ts,tsx}',
  'packages/*/src/**/*.test.{ts,tsx}',
  'packages/*/test/**/*.test.ts',
  'examples/*/src/**/*.test.{ts,tsx}',
  'cases/*/src/**/*.test.{js,ts,tsx}',
];

/** Each slice's marker; the unit slice has none. */
export const MARKERS = { unit: undefined, integration: 'integration', chromium: 'chromium' };

const OTHERS = Object.values(MARKERS).filter((marker) => marker !== undefined);

/** The globs a slice runs. */
export function includeOf(name) {
  const marker = MARKERS[name];
  return marker === undefined ? PLACES : PLACES.map((place) => place.replace('*.test.', `*.${marker}.test.`));
}

/** The globs a slice leaves to the others: the unit slice leaves every marked file. */
export function excludeOf(name) {
  return MARKERS[name] === undefined ? OTHERS.map((other) => `**/*.${other}.test.*`) : [];
}

/** Whether the slice runs the repository-relative `path`. */
export function inSlice(name, path) {
  return picomatch(includeOf(name))(path) && !picomatch(excludeOf(name))(path);
}
