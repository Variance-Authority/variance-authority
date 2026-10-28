// compass: variance-authority.reach
/**
 * Where one changed file goes once nothing before reach claimed the suite.
 *
 * A file the record measured is answered by the record: the regions its lines
 * fell in, and the tests that declare it. A file the record did not measure —
 * one added since the run, a stylesheet no probe can sit in, a module the build
 * never instrumented — has no row to read, and the record alone says nothing
 * about it. The import graph can: the first tests that import it, or the first
 * file on the way to them that the record did measure.
 *
 * Whether to ask the graph is the suite's to say, as `suites.<name>.relations`.
 * A unit suite imports what it tests, so the graph names its audience. An e2e
 * suite reaches the app through a browser and imports none of it: the graph
 * names nobody, or a unit test's neighbour by accident, and the suite says what
 * it rests on in its own `before` instead. A file such a suite did not measure
 * goes nowhere, and the answer says it was declined rather than unread.
 *
 * Before any of that, a suite may say that some changes move none of its
 * tests, as `suites.<name>.ignore`: a unit suite renders no pixel, so a changed
 * stylesheet or image reaches none of its assertions, though the graph would
 * name every test that imports the component. A changed file a pattern
 * matches loses what selection infers from it and keeps what a test declared
 * of it, and is named as ignored.
 */

import { codeUnitOrder } from '@variance-authority/core/segment';
import picomatch from 'picomatch';
import type { DeclaredSuite } from './suites.js';

/** The stage a changed file is answered by. */
export type Route = 'coverage' | 'relations' | 'nothing';

/**
 * What a suite does with a file its record did not measure: ask the graph, or
 * nothing. Absent is `relations`, which is every suite's until it declines.
 */
export type Unmeasured = 'relations' | 'nothing';

/** What `suite` does with a file its record did not measure, as its declaration says. */
export function unmeasuredOf(suite: DeclaredSuite | undefined): Unmeasured | undefined {
  return suite?.relations === false ? 'nothing' : undefined;
}

/**
 * Whether a suite's `ignore` patterns match a path: some pattern matches it and
 * no `!` pattern does, dotfiles included. Paths and patterns are both from the
 * repository root, as the diff spells them. Undefined when the suite ignores
 * nothing.
 */
export function ignoreMatcher(patterns: readonly string[] | undefined): ((path: string) => boolean) | undefined {
  if (patterns === undefined || patterns.length === 0) return undefined;
  const kept = patterns.filter((glob) => glob.startsWith('!')).map((glob) => glob.slice(1));
  const ignores = picomatch(patterns.filter((glob) => !glob.startsWith('!')), { dot: true });
  const keeps = kept.length === 0 ? undefined : picomatch(kept, { dot: true });
  return (path) => ignores(path) && keeps?.(path) !== true;
}

/** The changed files a suite's `ignore` patterns match, in code-unit order. */
export function ignoredBy(patterns: readonly string[] | undefined, files: Iterable<string>): readonly string[] {
  const matches = ignoreMatcher(patterns);
  if (matches === undefined) return [];
  return [...new Set(files)].filter((file) => matches(file)).sort(codeUnitOrder);
}

/** `byFile` without the entries for `paths`, the files a suite ignores. */
export function withoutPaths<Value>(byFile: ReadonlyMap<string, Value>, paths: readonly string[]): ReadonlyMap<string, Value> {
  if (paths.length === 0) return byFile;
  const drop = new Set(paths);
  return new Map([...byFile].filter(([file]) => !drop.has(file)));
}

/** The route of one changed file. */
export function routeOf(measured: boolean, unmeasured: Unmeasured | undefined): Route {
  if (measured) return 'coverage';
  return unmeasured === 'nothing' ? 'nothing' : 'relations';
}
