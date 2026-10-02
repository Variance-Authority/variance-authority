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
 */

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

/** The route of one changed file. */
export function routeOf(measured: boolean, unmeasured: Unmeasured | undefined): Route {
  if (measured) return 'coverage';
  return unmeasured === 'nothing' ? 'nothing' : 'relations';
}
