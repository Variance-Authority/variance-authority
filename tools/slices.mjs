/** Where the suite's tests live, and what each slice runs: read by `vitest.config.mts`. */

import { configDefaults } from 'vitest/config';

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

/**
 * The globs a slice does not run: Vitest's own, and for the unit slice every
 * file another slice's marker names.
 */
export function excludeOf(name) {
  const others = MARKERS[name] === undefined ? OTHERS.map((other) => `**/*.${other}.test.*`) : [];
  return [...configDefaults.exclude, ...others];
}

