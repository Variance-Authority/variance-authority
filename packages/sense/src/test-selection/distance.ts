/**
 * How far a change had to travel to reach a test, and what it went through to
 * get there.
 *
 * [`select.ts`](./select.ts) answers *which* tests a diff reached and keeps the
 * facts that put each one in the answer. Every one of those facts names a file:
 * a region is in a module, an importer chain starts at the changed file, a
 * precondition is the changed file itself. That is one end of a path. The test
 * file is the other, and the snapshot already says which modules ran in between,
 * because it recorded every one the test entered.
 *
 * So the path is derivable, and it is worth deriving twice over:
 *
 * - **A failure at a distance is a finding, not a fact about the test.** A test
 *   three hops from an edit that fails because of it has crossed two modules
 *   whose contracts held. A test that fails with *no* executed path from the
 *   change reached it through something the import graph cannot see — a
 *   singleton, a patched prototype, a registry, a module-level assignment — and
 *   a test that only reaches it by landing inside a unit rather than on its face
 *   reached past an interface somebody wrote. Both are defects with an address.
 * - **A suite has a nearest end.** The tests of the edited module, then the
 *   tests of its callers, then the rest. Running them in that order is how a
 *   loop learns it is wrong in seconds instead of minutes, and `bands.ts` next
 *   door cuts the reading into exactly those rings.
 *
 * ## The graph alone would answer wider, and would answer wrong
 *
 * `dependentsOf` over the whole graph gives a shortest path from any change to
 * any file, and it is the wrong path: it goes through modules the test never
 * loaded. A component that imports a helper behind a branch nobody took is on
 * that path and was not on the run's. So the walk is restricted to the modules
 * this test actually entered, which is a fact the snapshot holds and no build
 * tool has. The distance reported is therefore a distance something travelled,
 * not one something could have travelled.
 *
 * ## A distance nobody measured is absent
 *
 * ADR-0002. A test selected with no executed path to the change gets no `hops`
 * — never zero, which is the number for *the change is this test's own source*
 * and means the opposite. The two are told apart by {@link Bearing}, and a
 * caller that sorts on a missing number would put the least explained work
 * first, which is the right place for it and the wrong reason.
 */

import { dependenciesOf, idOf, nodeAt, trailOf, type NodeId, type Relations } from '@variance-authority/core/relate';
import type { TestCoverageView } from './format-view.js';
import { findTest } from './lookup.js';
import type { ExecutionNarrowing, SelectionCause } from './select.js';

/**
 * The public face `importer` reached past to get to `reached`, if it reached
 * past one.
 *
 * A *unit* is a directory whose contents are meant to be reached through one
 * file. What makes a directory one is a convention, not a fact about the
 * filesystem, so this is supplied rather than inferred: `indexFaces` in
 * [`faces.ts`](./faces.ts) reads the one this repository and most others keep —
 * a directory with an `index` module — and a caller with a manifest, a build
 * config, or a lint rule saying otherwise hands over its own.
 *
 * Both ends are given because a boundary only exists between them. `button/index.ts`
 * importing `button/parts/glyph.ts` has reached into `parts`; `checkout/page.tsx`
 * importing the same file has reached past `button` as well, and the second is
 * the sentence worth printing. One provider holding both ends decides that once;
 * two callers comparing prefixes decide it twice and disagree eventually.
 *
 * `undefined` when nothing was reached past: `reached` is a face, `importer` is
 * inside every unit `reached` is in, or neither is in a unit at all.
 */
export type Faces = (reached: string, importer: string) => Face | undefined;

export interface Face {
  /** The directory whose contents are meant to be reached through `entry`. */
  readonly unit: string;
  /** The file that unit is entered by. */
  readonly entry: string;
  /** What an importer outside the unit should name instead, when that is known. */
  readonly as?: string;
}

/** One hop that landed inside a unit instead of on its face. */
export interface ReachThrough {
  /** The file that reached in. */
  readonly importer: string;
  /** What it reached. */
  readonly reached: string;
  /** The unit `reached` is inside and `importer` is not. */
  readonly unit: string;
  /** The file that unit publishes itself as. */
  readonly entry: string;
  /** The name to import instead, when the face provider knows one. */
  readonly as?: string;
}

/**
 * What the path from a change to a test is, in one word.
 *
 * The first three are distances. The next two are findings, and they are the
 * reason this reading exists rather than a hop count on its own. The last is
 * neither: it is the answer withheld.
 *
 * - `precondition` — the change *is* the test: its own source, its setup, its
 *   mocks, its configuration. Nothing travelled; there is nothing between.
 * - `direct` — the test file imports the changed module. One hop.
 * - `transitive` — modules in between, every one of them entered on its face.
 *   The ordinary state of a suite, and not a complaint.
 * - `reach-through` — some hop landed inside a unit rather than on the file
 *   that unit is entered by. The change travelled past an interface. Whoever
 *   wrote that import took a dependency the unit does not offer, and the fix is
 *   at the importing line rather than anywhere near the failure.
 * - `unexplained` — the test was selected, no chain of imports it executed
 *   connects it to the change, **and** the graph accounted for the rest of that
 *   run. Effect at a distance in the literal sense: the change arrived by a
 *   route the import graph does not describe. A module-level side effect, a
 *   shared singleton, a monkey patch, a registry keyed by string, a global the
 *   two ends agree about and nothing declares. The second half of the condition
 *   is what makes it worth printing — one unexplained edge in a run the graph
 *   otherwise walks end to end is an address, and the same edge in a run it can
 *   barely follow is a fact about the graph.
 * - `unmeasured` — the graph could not answer. The test, the changed module, or
 *   something the test ran on the way between them is outside it: a built
 *   artifact the scan does not read, a directory it was not pointed at, a file
 *   whose imports nothing could enumerate. **Not** a finding, and the
 *   distinction is the whole of ADR-0002 — a walk that was never possible must
 *   not print as a walk that failed, or every unscanned directory in the
 *   repository becomes an accusation of effect at a distance. Carries
 *   {@link TestDistance.because}.
 */
export type Bearing =
  | 'precondition'
  | 'direct'
  | 'transitive'
  | 'reach-through'
  | 'unexplained'
  | 'unmeasured';

/** One selected test, and how far the change had to come. */
export interface TestDistance {
  readonly test: string;
  readonly bearing: Bearing;
  /**
   * Import hops from the change to the test, counted along edges this test
   * executed. Absent when no such path ran — never zero for that, because zero
   * is `precondition` and says the opposite.
   */
  readonly hops?: number;
  /** The changed file this reading measured from; the nearest, when several changed. */
  readonly from?: string;
  /** Change first, test file last. Present exactly when `hops` is. */
  readonly trail?: readonly string[];
  /** Every hop on `trail` that landed inside a unit. Absent when none did. */
  readonly through?: readonly ReachThrough[];
  /**
   * Why nothing could be measured, in the words of the walk that gave up.
   *
   * Present exactly when the bearing is `unmeasured`, and carried rather than
   * reduced to the flag the bearing already is: *the graph does not hold
   * `packages/core/dist/relate/reach.js`* is a scan to widen, and *4 modules it
   * entered are outside the graph* is the same sentence about someone else's
   * build. A report that said only `unmeasured` would leave both of them
   * looking like the tool's problem rather than a line in a config.
   */
  readonly because?: string;
}

export interface DistanceOptions {
  /** The file graph the path is walked in. Without it nothing can be placed. */
  readonly relations?: Relations;
  /** Every name the snapshot and the graph may hold one file under. Identity when absent. */
  readonly knownAs?: (file: string) => readonly string[];
  /** Where a unit's public face is. Nothing reads as *every file is its own face*. */
  readonly faces?: Faces;
  /**
   * Whether the graph enumerated what this file imports.
   *
   * A graph holds two kinds of node: files something read, and files something
   * *pointed at*. The second kind has in-edges and no out-edges, and is
   * indistinguishable in the structure from a module that genuinely imports
   * nothing — so whoever built the graph is asked, because only they know which
   * tree they scanned. A walk that dead-ends on one of these has not found the
   * absence of a route; it has run out of graph, and the difference is
   * `unexplained` against `unmeasured`.
   *
   * Everything reads as enumerated when absent, which is right for a graph built
   * over the whole tree and wrong — in the direction of accusing somebody — for
   * one built over part of it.
   */
  readonly enumerated?: (file: string) => boolean;
}

/**
 * Place every test a narrowing selected, nearest first.
 *
 * The narrowing is the input rather than the diff, because the join is already
 * in it: `because` names, per test, every changed file that selected it and how.
 * Re-deriving that here would be a second implementation of the rule in
 * `select.ts` and would drift from it (`docs-exercised`'s whole argument).
 *
 * Ordering is by hops, then by path in code-unit order, with the unplaced last —
 * not because they matter least but because a band that runs them is a band that
 * has stopped narrowing, and a caller slicing the front of this list should have
 * to reach past everything measured to get to them.
 */
export function distanceFromView(
  coverage: TestCoverageView,
  narrowing: ExecutionNarrowing,
  options: DistanceOptions = {},
): readonly TestDistance[] {
  const entered = enteredByTest(coverage);
  const placed = narrowing.because.map((cause) => place(coverage, cause, entered, options));
  return [...placed].sort(nearestFirst);
}

/** The one comparison every consumer of this reading sorts by. */
export function nearestFirst(left: TestDistance, right: TestDistance): number {
  if (left.hops !== right.hops) {
    if (left.hops === undefined) return 1;
    if (right.hops === undefined) return -1;
    return left.hops - right.hops;
  }
  return left.test < right.test ? -1 : left.test > right.test ? 1 : 0;
}

/**
 * One test placed against every changed file that selected it.
 *
 * A precondition ends it: nothing is nearer than *this change is this test*, and
 * no walk can improve on zero. Everything else is a seed, and the walk runs once
 * from the test rather than once per seed — the same reason `dependentsOf` takes
 * a seed set, read from the other end.
 */
function place(
  coverage: TestCoverageView,
  cause: SelectionCause,
  entered: ReadonlyMap<number, ReadonlySet<string>>,
  options: DistanceOptions,
): TestDistance {
  const seeds: string[] = [];
  for (const reason of cause.via) {
    if (reason.kind === 'precondition') {
      return { test: cause.test, bearing: 'precondition', hops: 0, from: reason.name, trail: [reason.name] };
    }
    if (reason.kind === 'region') seeds.push(reason.file);
    // An importer chain is already a measured path from the changed file to the
    // module whose row answered. Its far end is where the walk below picks up,
    // and the chain is spliced back on once there is something to splice it to.
    else if (reason.trail.length > 0) seeds.push(reason.trail[reason.trail.length - 1]!);
  }

  const chains = new Map<string, readonly string[]>();
  for (const reason of cause.via) {
    if (reason.kind === 'importer' && reason.trail.length > 0) {
      chains.set(reason.trail[reason.trail.length - 1]!, reason.trail);
    }
  }

  const walked = walk(cause.test, seeds, entered.get(findTest(coverage, cause.test) ?? -1) ?? new Set(), options);
  if ('because' in walked) {
    return walked.because === undefined
      ? { test: cause.test, bearing: 'unexplained' }
      : { test: cause.test, bearing: 'unmeasured', because: walked.because };
  }

  // The importer chain, when one answered, is hops the change travelled through
  // files no probe could sit in. They count: a stylesheet two `@import`s away
  // from the component is two hops away from it.
  const prefix = chains.get(walked.trail[0]!)?.slice(0, -1) ?? [];
  const trail = [...prefix, ...walked.trail];
  const through = reachThroughs(trail, options.faces);
  const hops = trail.length - 1;
  return {
    test: cause.test,
    bearing: through.length > 0 ? 'reach-through' : hops <= 1 ? 'direct' : 'transitive',
    hops,
    from: trail[0]!,
    trail,
    ...(through.length === 0 ? {} : { through }),
  };
}

/**
 * What a walk came back with: a path, a reason it could not be measured, or
 * `because: undefined` — measured, and there is no path. The third is the only
 * one that is a finding, and it is spelled as a present key with no value so
 * that adding a reason somewhere is a compile error rather than a silent
 * reclassification of somebody's unscanned directory as effect at a distance.
 */
type Walked = { readonly trail: readonly string[] } | { readonly because: string | undefined };

/**
 * The shortest executed path from this test's file to any of the seeds.
 *
 * From the test rather than from the change, for two reasons that are the same
 * reason. The frontier is bounded by what this test entered, which is small,
 * where a walk from the change spreads over every dependent in the repository
 * before it finds out which of them ran. And the restriction is expressible as
 * `avoid`, which `reach.ts` already applies before the inner loop — a module the
 * test never entered is removed from the graph exactly the way a mocked one is,
 * because for this question they are the same thing.
 *
 * `depends` is walked, so the trail comes back test-first and is reversed. A
 * shortest path is a shortest path in either direction; the report reads from
 * the change, which is where the author is standing.
 */
function walk(
  test: string,
  seeds: readonly string[],
  entered: ReadonlySet<string>,
  options: DistanceOptions,
): Walked {
  const { relations } = options;
  if (relations === undefined) return { because: 'no import graph was supplied' };
  if (seeds.length === 0) return { because: 'nothing named a file to measure from' };
  const knownAs = options.knownAs ?? ((file: string): readonly string[] => [file]);
  const held = options.enumerated ?? ((): boolean => true);

  // Every name, not the first one that resolves. One module can be two nodes —
  // a workspace package is imported through its manifest, so an importer's edge
  // lands on `dist` while the snapshot recorded `src`, and picking either one
  // leaves the other cut out of the graph at exactly the hop that mattered.
  // `knownAs` is documented as every name a file is held under; honouring one of
  // them would make that sentence false.
  const nodes = (file: string): readonly NodeId[] => {
    const found: NodeId[] = [];
    for (const name of knownAs(file)) {
      const id = idOf(relations, 'file', name);
      if (id !== undefined) found.push(id);
    }
    return found;
  };

  const start = nodes(test);
  if (start.length === 0) return { because: `the graph does not hold ${test}` };

  // Everything the test did not enter is removed from the graph. The test's own
  // file is never a module row — nothing instruments one — so it is admitted by
  // name, and so is every seed: a changed module the test entered is in
  // `entered` already, and one it did not is unreachable either way.
  const open = new Uint8Array(relations.names.length);
  for (const id of start) open[id] = 1;
  // A module the test ran and the graph never read is a hole in the middle of
  // the route, not a shorter route. Counted, because a walk that failed with one
  // of these on the frontier has not measured anything — see `Walked`.
  let blind = 0;
  for (const file of entered) {
    const found = nodes(file);
    if (found.length === 0) blind += 1;
    for (const id of found) open[id] = 1;
  }
  const wanted = new Map<NodeId, string>();
  for (const seed of seeds) {
    for (const id of nodes(seed)) {
      wanted.set(id, seed);
      open[id] = 1;
    }
  }
  if (wanted.size === 0) {
    const [first] = seeds;
    return {
      because: `the graph does not hold ${first}${seeds.length === 1 ? '' : ` or ${seeds.length - 1} other changed file(s)`}`,
    };
  }

  const avoid: NodeId[] = [];
  for (let id = 0; id < open.length; id += 1) if (open[id] !== 1) avoid.push(id);

  const traversal = dependenciesOf(relations, start, { avoid });
  let best: readonly NodeId[] | undefined;
  for (const id of wanted.keys()) {
    if (traversal.mask[id] !== 1) continue;
    const trail = trailOf(traversal, id);
    if (best === undefined || trail.length < best.length) best = trail;
  }
  if (best === undefined) {
    // Nothing connected the two ends. Whether that is a finding depends entirely
    // on whether the graph was in a position to find one, and it was not if the
    // walk ran out of graph on the way — either at a module the test entered and
    // the graph has never heard of, or at one it holds without ever having read
    // what that file itself imports.
    if (blind > 0) return { because: `${blind} module(s) it covered are outside the graph` };
    for (const id of traversal.nodes) {
      const name = nodeAt(relations, id)?.name;
      if (name !== undefined && !held(name)) return { because: `nothing enumerated what ${name} imports` };
    }

    // Last: how much of this run the graph accounted for at all. A test whose
    // every other module the walk reached, and which still has no path to the
    // change, has one unexplained edge. A test the walk could reach almost
    // nothing of ran through something else entirely — a runner, a harness, a
    // second build of the same source — and the graph's silence about one more
    // module is not evidence of anything.
    let stranded = 0;
    for (const file of entered) {
      const found = nodes(file);
      if (found.length > 0 && found.every((id) => !wanted.has(id) && traversal.mask[id] !== 1)) stranded += 1;
    }
    return stranded === 0
      ? { because: undefined }
      : { because: `it ran ${stranded} other module(s) the graph cannot connect it to` };
  }

  const named: string[] = [];
  for (const id of best) named.push(nodeAt(relations, id)?.name ?? '');
  return { trail: named.reverse() };
}

/**
 * The hops on a trail that landed inside a unit.
 *
 * Read from the test end, because that is the direction an import is written in:
 * the file at `index + 1` is imported by the file at `index`, once the trail is
 * change-first. Whether a hop crossed a face is {@link Faces}'s question and is
 * asked with both ends, so the rule for what counts as reaching past one lives
 * with whoever knows where the faces are.
 */
function reachThroughs(trail: readonly string[], faces: Faces | undefined): readonly ReachThrough[] {
  if (faces === undefined) return [];
  const found: ReachThrough[] = [];
  for (let at = trail.length - 1; at > 0; at -= 1) {
    const importer = trail[at]!;
    const reached = trail[at - 1]!;
    const face = faces(reached, importer);
    if (face === undefined) continue;
    found.push({
      importer,
      reached,
      unit: face.unit,
      entry: face.entry,
      ...(face.as === undefined ? {} : { as: face.as }),
    });
  }
  return found;
}

/**
 * Every module each test's process ran, in one pass over the crossings.
 *
 * Loaded-by is folded in beside entered. A module a test loaded but entered no
 * region of still ran in that test's process and still carried the import that
 * connects it to whatever it imported, and leaving it out would break paths that
 * exist — reporting `unexplained` for a change that arrived along an ordinary
 * chain. This walk over-includes for the same reason every other one here does.
 */
function enteredByTest(coverage: TestCoverageView): ReadonlyMap<number, ReadonlySet<string>> {
  const byTest = new Map<number, Set<string>>();
  const add = (test: number, file: string): void => {
    const already = byTest.get(test);
    if (already === undefined) byTest.set(test, new Set([file]));
    else already.add(file);
  };

  for (let module = 0; module < coverage.modulePath.length; module += 1) {
    const file = coverage.string(coverage.modulePath.at(module));
    const first = coverage.moduleBlocks.at(module);
    const end = coverage.moduleBlocks.at(module + 1);
    for (let block = first; block < end; block += 1) {
      for (const test of coverage.crossings.members(coverage.blockSet.at(block))) {
        add(test, file);
      }
      for (const test of coverage.crossings.members(coverage.blockLoadedSet.at(block))) {
        add(test, file);
      }
    }
  }
  return byTest;
}
