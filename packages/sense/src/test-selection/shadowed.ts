/**
 * A mock, held against the record when the record is read.
 *
 * `vi.mock('./api')` and `jest.mock('./api')` without a factory still run
 * `api.ts`. The runner evaluates the real module to learn the shape of the
 * automock it hands the test — Jest through `_generateMock`, which swaps in
 * empty registries and calls `requireModule` — and the probes record that
 * evaluation as the test's crossings, `loadedBy` on every block they reached.
 * Read as they stand, those crossings say the test entered the module it
 * mocked: an edit to `api.ts` selects the test that replaced it, and the taint
 * audit reports a mock that did not take. Neither is true. The test ran against
 * the mock, and nothing in the real module's text changes what the mock
 * returns; its export shape can, and a shape change is a type error before it
 * is a test failure.
 *
 * So a test's *load-time* crossings into a module it shadows are disowned — the
 * module itself, and every file the test reaches only through it. Nothing
 * else is. A test file is boxes in boxes: the file's load, its hooks, and each
 * case inside them. A mock is installed before all of them, at the file's load,
 * so everything the record saw inside a hook or a case ran against the mocks
 * already in place, and what it entered it really entered — a `jest.fn` handed
 * the original, a `mockImplementation` restoring it, a module reached by a
 * route the scan cannot see. Only module evaluation is ambiguous, because that
 * is the box a runner uses to evaluate the real module on the mock's behalf;
 * the record marks it (`loaded`, `loadedBy`), and only there does the mock
 * decide. A case journal credits evaluation to no case, so a journey file's
 * crossings are all a case's own, and its load-time regions are answered by
 * the graph, which carries the shadows.
 *
 * Nothing here writes to the record. A taint is a join, and one snapshot has to
 * stay readable under several taints, or none, without a second recording.
 */

import { dependenciesOf, idOf, nodeAt, type NodeId, type Relations } from '@variance-authority/core/relate';
import type { TestCoverageView } from './format-view.js';

/** Per test file, every file its run never reaches. */
export type ShadowedFor = (test: string) => ReadonlySet<string>;

const NONE: ReadonlySet<string> = new Set();

/**
 * The files a test's shadows take out of its graph: the shadows themselves, and
 * every file reached only through them.
 *
 * `Relations.shadows` is the table `relationsOfFiles` was handed — the CLI joins
 * `Tainted.shadows` there — so a caller holding the graph already holds the
 * taint, and a graph built without one disowns nothing. A mocked module's own
 * imports ran under the same `requireModule` as the module did, so they carry
 * the same loading crossings and are disowned by the same rule; a file the test
 * also reaches by a route of its own is not, because that route loads it for
 * real.
 *
 * The transitive half is read off the edges the scan could read. A file whose
 * imports could not all be read contributes the edges it has and no others, the
 * same as it does to every other walk over the graph: a dependency of the mock
 * that such a file also loads through an unreadable expression is disowned with
 * the mock. That is the position, not an oversight: a walk that stopped at
 * every such file would give up the transitive half for the whole test over one
 * expression nobody could read.
 *
 * Memoized per test, because a selection asks once per crossing and the walk is
 * the cost.
 */
export function shadowedFor(relations: Relations | undefined): ShadowedFor | undefined {
  if (relations === undefined || relations.shadows.size === 0) return undefined;
  const { shadows } = relations;
  const held = new Map<string, ReadonlySet<string>>();

  return (test) => {
    const known = held.get(test);
    if (known !== undefined) return known;
    const direct = shadows.get(test) ?? [];
    const found = direct.length === 0 ? NONE : closure(relations, test, direct);
    held.set(test, found);
    return found;
  };
}

function closure(relations: Relations, test: string, direct: readonly string[]): ReadonlySet<string> {
  const found = new Set(direct);
  const seed = idOf(relations, 'file', test);
  if (seed === undefined) return found;
  const cut = direct.map((file) => idOf(relations, 'file', file)).filter((id): id is NodeId => id !== undefined);
  const kept = dependenciesOf(relations, [seed], { avoid: cut });
  for (const id of dependenciesOf(relations, cut).nodes) {
    if (kept.mask[id] === 1) continue;
    const node = nodeAt(relations, id);
    if (node?.kind === 'file') found.add(node.name);
  }
  return found;
}

/**
 * Whether a test's crossing of one block in an instrumented row is disowned by
 * its mocks: the test mocked the row's file, or reaches it only through a mock,
 * and it crossed the block only while the module evaluated.
 *
 * `file` is the graph's name for the row — the name shadows are written in.
 * Without `block` the question is the graph's alone, for a file the test holds
 * no crossing of. Undefined when the graph carries no shadows, so a caller
 * without a taint pays nothing per crossing.
 */
export type Disowned = (file: string, test: number, block?: number) => boolean;

export function disownedIn(coverage: TestCoverageView, relations: Relations | undefined): Disowned | undefined {
  const shadowed = shadowedFor(relations);
  if (shadowed === undefined) return undefined;
  return (file, test, block) =>
    (block === undefined || coverage.crossings.has(coverage.blockLoadedSet.at(block), test)) &&
    shadowed(coverage.string(coverage.testPath.at(test))).has(file);
}
