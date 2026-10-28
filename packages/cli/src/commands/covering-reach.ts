/**
 * Which of the tests that went there are close enough to count.
 *
 * `covering` answers *who reached this line*, and on real code the answer is
 * often long. Two of the ways it is long are structural rather than
 * interesting: a test five packages away that reached the line through a chain
 * nobody would call a dependency, and a test in another package entirely that
 * reached it because everything reaches a base module. Neither is a wrong
 * answer and neither is the one somebody editing the line is asking for.
 *
 * So the witnesses are narrowed by where the *test* sits, never by what the
 * crossing recorded. Nothing here reads
 * [`ExecutionCrossing.distance`](https://github.com/Variance-Authority/variance-authority/blob/main/packages/sense/src/test-selection/reverse.ts):
 * that is call-stack depth, ADR-0056 forecloses recording one, and this
 * project's own collector writes zero into it. The quantity used instead is
 * import hops from the file under the question to the test's own file, walked
 * over the graph a scan produced — the same number `variance reach` walks and
 * the same one `atDistance` ranges over.
 *
 * ## An answer may not carry the unplaced
 *
 * `atDistance` gives tests with no measured distance to the leg that holds the
 * furthest measured hop, because a loop that never runs them is a loop that
 * skipped work.
 * This is not a loop. A test nobody could place is not within three hops — it
 * is a test the walk could not measure — so it is dropped from the list and
 * counted in a note. Reporting it inside the band would answer *yes, something
 * nearby covers this* on evidence that says nothing of the kind.
 *
 * ## Hops are per test file
 *
 * The record places test *files*; the case sidecar names cases inside them. So
 * every case of one file shares that file's distance, and a band cannot
 * separate two cases in the same file. That is the grain the snapshot holds and
 * not a rounding: `at-source.ts` says the same thing from the other end.
 */

import {
  distanceToSource,
  type CoveringTest,
  type SourcePoint,
  type SourceTestRange,
} from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import { packageOf } from '../package-home.js';
import { snapshotFor } from './covering-frame.js';
import { relationsFor } from './source-graph.js';
import type { CoveringAt } from '../covering-args.js';

/** A filter over witnesses, and what it has to say for itself. */
export interface Narrowing {
  /** Whether this witness survives every filter that was asked for. */
  readonly keep: (test: CoveringTest) => boolean;
  /** Facts about the narrowing an operator has to be told, whichever way it went. */
  readonly notes: readonly string[];
  /** True when nothing was asked, so callers can skip the work of applying it. */
  readonly whole: boolean;
}

const KEEP_EVERYTHING: Narrowing = { keep: () => true, notes: [], whole: true };

/**
 * Build the filter the flags asked for, reading the graph only if one did.
 *
 * `--at-distance` costs a scan of the tree and a pass over the snapshot, which
 * is why it is not the default and why `distanceToSource` is a separate entry
 * point from `testsReaching` in the library. Nothing here is paid for by a
 * question that did not ask.
 */
export async function nearbyWitnesses(request: CoveringAt): Promise<Narrowing> {
  if (request.atDistance === undefined && request.inPackage !== true) return KEEP_EVERYTHING;

  const notes: string[] = [];
  const filters: ((test: CoveringTest) => boolean)[] = [];

  if (request.inPackage === true) {
    const home = packageOf(request.root, request.file);
    if (home === undefined) {
      throw new OperatorError(
        `\`--in-package\` scopes the answer to the package holding \`${request.file}\`, and no ` +
          `\`package.json\` stands above it inside \`${request.root}\`. In a checkout with one ` +
          'manifest at the root every test is in the same package and the flag has nothing to do.',
      );
    }
    notes.push(`scoped to the package at ${home === request.root ? '.' : relativeTo(request.root, home)}`);
    filters.push((test) => packageOf(request.root, test.file) === home);
  }

  if (request.atDistance !== undefined) {
    const { from, to } = request.atDistance;
    const { byFile: hops, unread } = await hopsToTests(request);
    // A snapshot that cannot measure any distance keeps no test, and says so.
    if (unread !== undefined) notes.push(unread);
    const unplaced = [...hops.values()].filter((distance) => distance === undefined).length;
    // A file the graph cannot place is left out of the band, not carried into
    // it: an unmeasured distance is not a short one.
    if (unplaced > 0) notes.push(`${unplaced} test file${unplaced === 1 ? '' : 's'} not on the import graph; left out`);
    filters.push((test) => {
      const distance = hops.get(test.file);
      return distance !== undefined && distance >= from && distance <= to;
    });
  }

  return { keep: (test) => filters.every((filter) => filter(test)), notes, whole: false };
}

/**
 * Import hops from the point to every test file the snapshot saw there.
 *
 * Keyed by test file, because that is what the record places. A test file the
 * walk reached is a number; one it could not is present with `undefined`, so a
 * caller can tell *far away* from *unmeasured* — the distinction the note above
 * exists to print. Measured once per question: `--at-distance` and `--hops`
 * read the same walk.
 */
export function hopsToTests(request: CoveringAt): Promise<Hops> {
  let measured = MEASURED.get(request);
  if (measured === undefined) MEASURED.set(request, (measured = measureHops(request)));
  return measured;
}

/** Import hops to each test file, or why none could be read. */
export interface Hops {
  readonly byFile: ReadonlyMap<string, number | undefined>;
  /** Present when the snapshot holds no row for the file, so no distance was measured. */
  readonly unread?: string;
}

const MEASURED = new WeakMap<CoveringAt, Promise<Hops>>();

async function measureHops(request: CoveringAt): Promise<Hops> {
  const relations = await relationsFor(request.root, ['.'], [], []);

  // A hop runs from the file to a test file, whichever of the file's regions the
  // test entered, so a run of lines and every `--function`, exact name or scope,
  // measure from the file: the point cannot spell a run or a scope, and the
  // listed test files come from the answer, not from the point.
  const point: SourcePoint = {
    file: request.file,
    ...(request.line === undefined ? {} : { line: request.line }),
  };

  const snapshot = await snapshotFor(request);
  if (snapshot === undefined) {
    throw new OperatorError(
      'import hops are read from a suite\'s coverage snapshot, and an index named by `--execution` is no ' +
        'declared suite\'s; ask with `--suite <name>` instead.',
    );
  }
  const { audience, distances } = await distanceToSource(
    snapshot,
    point,
    { relations },
  );
  if (!audience.recorded) {
    // One run writes the per-case index and the snapshot, so a file in one and not the other means two runs.
    return {
      byFile: new Map(),
      unread: `import hops are unmeasured: the coverage snapshot at ${snapshot} holds no instrumented row for ${request.file}, ` +
        'though the per-case index holds it, so the two are from different runs and no test file\'s distance can be read',
    };
  }

  const hops = new Map<string, number | undefined>();
  for (const distance of distances) hops.set(distance.test, distance.hops);
  return { byFile: hops };
}

function relativeTo(root: string, directory: string): string {
  return directory.startsWith(`${root}/`) ? directory.slice(root.length + 1) : directory;
}

/** How many distinct named tests a set of ranges names. */
export function identities(ranges: readonly SourceTestRange[]): number {
  return new Set(ranges.flatMap((range) => range.tests.map((test) => test.id))).size;
}
