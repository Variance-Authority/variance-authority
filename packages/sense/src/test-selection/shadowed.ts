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
 * So a test's crossings into a module it shadows are disowned — the module
 * itself, and every file the test reaches only through it — whatever those
 * crossings were. A mocked module's content is not part of the test: what the
 * test ran against is the mock, and a mock whose shape drifted from the real
 * module is the type checker's to report, not the selection's. That holds even
 * when the record shows the real code called on the test's behalf, which is a
 * mock that did not take — the taint audit names that as
 * `shadowed-but-entered`, and fixing the mock is the answer to it, not running
 * the test on every edit to the module it meant to replace.
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
 * Whether a test's crossings in one instrumented row are disowned by its mocks.
 *
 * `file` is the graph's name for the row — the name shadows are written in.
 * Undefined when the graph carries no shadows, so a caller without a taint pays
 * nothing per crossing.
 */
export type Disowned = (file: string, test: number) => boolean;

export function disownedIn(coverage: TestCoverageView, relations: Relations | undefined): Disowned | undefined {
  const shadowed = shadowedFor(relations);
  if (shadowed === undefined) return undefined;
  return (file, test) => shadowed(coverage.string(coverage.testPath.at(test))).has(file);
}
