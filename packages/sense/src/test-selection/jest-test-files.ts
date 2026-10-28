/**
 * Which files Jest calls tests: its reading of `testMatch` and `testRegex`, as
 * a transformer sees them in the project configuration Jest hands it. `isolator`
 * keeps a copy, as `jest-transformer.ts` says.
 */

import picomatch from 'picomatch';

/** The fields of Jest's project configuration that say which files are tests. */
export interface JestTestFiles {
  /** Globs, with `<rootDir>` already replaced, as Jest normalizes them. */
  readonly testMatch?: readonly string[];
  readonly testRegex?: string | readonly string[];
}

const testMatchers = new Map<string, (path: string) => boolean>();

/**
 * Whether Jest calls the file at an absolute path a test: a `testMatch` glob
 * list read by {@link globMatcher}, or a `testRegex` list where any pattern
 * decides, tested against the path as the runner spells it.
 */
export function isTestFile(path: string, config: JestTestFiles): boolean {
  const globs = config.testMatch ?? [];
  const regexes = typeof config.testRegex === 'string' ? [config.testRegex] : config.testRegex ?? [];
  const identity = JSON.stringify([globs, regexes]);
  let matcher = testMatchers.get(identity);
  if (matcher === undefined) {
    const matches = globMatcher(globs);
    const patterns = regexes.map((regex) => new RegExp(regex));
    matcher = (candidate) => matches(candidate) || patterns.some((pattern) => pattern.test(candidate));
    testMatchers.set(identity, matcher);
  }
  return matcher(path);
}

/**
 * Jest's reading of a glob list: a path matches one positive pattern and no
 * negated one, dotfiles included, with a Windows separator read as `/`.
 */
export function globMatcher(globs: readonly string[]): (path: string) => boolean {
  const positive = globs.filter((glob) => !glob.startsWith('!')).map((glob) => picomatch(glob, { dot: true }));
  const negative = globs.filter((glob) => glob.startsWith('!')).map((glob) => picomatch(glob.slice(1), { dot: true }));
  return (path) => {
    const candidate = slashed(path);
    return positive.some((match) => match(candidate)) && !negative.some((match) => match(candidate));
  };
}

/** Jest's `replacePathSepForGlob`: a backslash is a separator unless it escapes a glob's special character. */
export function slashed(path: string): string {
  return path.replaceAll(/\\(?![$()+.?^{}])/g, '/');
}
