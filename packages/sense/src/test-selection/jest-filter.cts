/**
 * The module a selecting Jest configuration names as its `filter`.
 *
 * Jest takes a filter as a path and `require`s it in the process that loaded
 * the configuration, so the selection that configuration was handed is still
 * in memory here: `jest-selection.ts` leaves the function that drops files
 * under a symbol on `globalThis`, and this module calls it. No path crosses
 * argv, the environment or a file.
 */

/** Where the configuration leaves its filter; mirrors `HANDED` in `jest-selection.ts`. */
const HANDED = Symbol.for('variance-authority:jest-selection');

interface Handed {
  readonly filter: (testPaths: readonly string[]) => Promise<{ filtered: string[] }>;
}

function filter(testPaths: readonly string[]): Promise<{ filtered: string[] }> {
  const handed = (globalThis as { [HANDED]?: Handed })[HANDED];
  if (handed === undefined) {
    throw new Error(
      'variance-authority: this filter drops what a selection skips, and no configuration wrapped by ' +
        '`withTestSelection` handed it one in this process',
    );
  }
  return handed.filter(testPaths);
}

export = filter;
