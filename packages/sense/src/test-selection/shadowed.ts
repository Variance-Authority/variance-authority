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

import { RUNTIME_EDGES, affectedBy, dependenciesOf, idOf, nodeAt, type NodeId, type Relations } from '@variance-authority/core/relate';
import type { TestCoverageView } from './format-view.js';
import { testPathOf } from './lookup.js';
import type { ExecutionBlock, ExecutionCrossing, ExecutionIndex, ExecutionModule } from './reverse.js';

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
 * Memoized per test and per graph, because a selection asks once per crossing,
 * a covering answer asks from several readers, and the walk is the cost.
 */
export function shadowedFor(relations: Relations | undefined): ShadowedFor | undefined {
  if (relations === undefined || relations.shadows.size === 0) return undefined;
  const kept = perGraph.get(relations);
  if (kept !== undefined) return kept;
  const { shadows } = relations;
  const held = new Map<string, ReadonlySet<string>>();

  const answer: ShadowedFor = (test) => {
    const known = held.get(test);
    if (known !== undefined) return known;
    const direct = shadows.get(test) ?? [];
    const found = direct.length === 0 ? NONE : closure(relations, test, direct);
    held.set(test, found);
    return found;
  };
  perGraph.set(relations, answer);
  return answer;
}

/** One answer per graph, so every reader of one question shares its walks. */
const perGraph = new WeakMap<Relations, ShadowedFor>();

function closure(relations: Relations, test: string, direct: readonly string[]): ReadonlySet<string> {
  const found = new Set(direct);
  const seed = idOf(relations, 'file', test);
  if (seed === undefined) return found;
  const cut = direct.map((file) => idOf(relations, 'file', file)).filter((id): id is NodeId => id !== undefined);
  const kept = dependenciesOf(relations, [seed], { through: RUNTIME_EDGES, avoid: cut });
  for (const id of dependenciesOf(relations, cut, { through: RUNTIME_EDGES }).nodes) {
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
  // Asked once per crossing, so a test's path is decoded once per test row
  // rather than once per question, and its shadows are walked once per test.
  const byRow = new Map<number, ReadonlySet<string>>();
  const shadowedBy = (test: number): ReadonlySet<string> => {
    let found = byRow.get(test);
    if (found === undefined) {
      found = shadowed(testPathOf(coverage, test));
      byRow.set(test, found);
    }
    return found;
  };
  // The shadows first: most tests mock nothing a crossing is in, and that answer
  // is a set lookup, where whether the test crossed the block while its module
  // evaluated is a read of the block's loaded set and of the set's members.
  return (file, test, block) =>
    shadowedBy(test).has(file) &&
    (block === undefined || coverage.crossings.has(coverage.blockLoadedSet.at(block), test));
}

/**
 * Whether a crossing in this module belongs to its case.
 *
 * Every crossing a case made is its own: its mocks were installed before it
 * ran. Only a crossing made while the module evaluated can be a mock's work —
 * a runner evaluating the real module to shape it — and a case whose file
 * mocked the module, or reaches it only through a mock, does not hold those.
 * See `shadowedFor`.
 */
export function ownedIn(
  index: ExecutionIndex,
  module: ExecutionModule,
  shadowed: ShadowedFor | undefined,
): (crossing: ExecutionCrossing) => boolean {
  if (shadowed === undefined) return () => true;
  return (crossing) => {
    if (crossing.loaded !== true) return true;
    const file = index.tests[crossing.test]?.file;
    return file === undefined || !shadowed(file).has(module.file);
  };
}

/**
 * Whether a module's run while it evaluated can belong to a case, when the
 * record writes that on the block and names nobody (`ExecutionBlock.loaded`).
 *
 * The file graph names who loaded it. It is a mock's run alone when the graph
 * holds the module and every recorded case's file, reaches none of those
 * files, and cut one by a mock on the way: the one file that would have loaded
 * it replaced it. Every other answer keeps the flag — no graph, no shadows, a
 * module or a case's file the graph does not hold, so it cannot say who loaded
 * it, a case that runs a file whose imports the scan could not all read, so the
 * graph does not know everything that case loaded, or a run no mock explains,
 * such as a page-side module a browser spec reached through the page. Asked
 * only of a graph that carries shadows.
 */
function loadOwned(index: ExecutionIndex, file: string, relations: Relations): boolean {
  const affected = affectedBy(relations, [file], { through: RUNTIME_EDGES });
  if (affected.missing.length > 0) return true;
  const recorded = new Set(index.tests.map((test) => test.file));
  if ([...recorded].some((one) => idOf(relations, 'file', one) === undefined)) return true;
  if (affected.files.some((one) => recorded.has(one))) return true;
  // A case that mocks the module itself loads the mock by every route, read or
  // not; any other case running an unread import may have loaded the real one.
  const mocks = (test: string) => relations.shadows.get(test)?.includes(file) === true;
  if (unreadFor(relations).some((one) => recorded.has(one) && !mocks(one))) return true;
  return !affected.shadowed.some((one) => recorded.has(one));
}

/**
 * The files that run a file whose imports the scan could not all read
 * (`Relations.unknown`), itself or through what they import: the files whose
 * every load the graph cannot name. A file that reaches one only through its
 * own mock is not among them, by the same cut as {@link shadowedFor}, since
 * that file ran under the mock's evaluation. One walk per graph, whatever the
 * module asked.
 */
function unreadFor(relations: Relations): readonly string[] {
  const kept = unreadPerGraph.get(relations);
  if (kept !== undefined) return kept;
  const seeds = [];
  for (let id: NodeId = 0; id < relations.unknown.length; id++) {
    const node = relations.unknown[id] === 1 ? nodeAt(relations, id) : undefined;
    if (node?.kind === 'file') seeds.push(node);
  }
  const found = seeds.length === 0 ? [] : affectedBy(relations, seeds, { through: RUNTIME_EDGES }).files;
  unreadPerGraph.set(relations, found);
  return found;
}

const unreadPerGraph = new WeakMap<Relations, readonly string[]>();

/**
 * The module's blocks holding only what their cases own, by {@link ownedIn}
 * and {@link loadOwned}: the one record every covering reader reads a region
 * from, so a mock's evaluation of the real module is nobody's entry, and
 * nobody's load, on any answer.
 */
export function ownedBlocks(
  index: ExecutionIndex,
  module: ExecutionModule,
  relations: Relations | undefined,
): readonly ExecutionBlock[] {
  if (relations === undefined) return module.blocks;
  const shadowed = shadowedFor(relations);
  if (shadowed === undefined) return module.blocks;
  const owned = ownedIn(index, module, shadowed);
  const loads = module.blocks.some((block) => block.loaded === true) && !loadOwned(index, module.file, relations);
  return module.blocks.map(({ loaded, ...block }) => ({
    ...block,
    ...(loaded === true && !loads ? { loaded } : {}),
    crossings: block.crossings.filter(owned),
  }));
}
