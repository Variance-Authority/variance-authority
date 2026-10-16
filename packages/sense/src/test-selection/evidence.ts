// compass: variance-authority.reach
/**
 * How much evidence a suite trusts before it skips a test.
 *
 * Selection reads one record, the regions each test entered, and the import
 * graph beside it. A team that adopts it rarely trusts the finest reading on
 * the first day: a skipped test is a cost they cannot see. So a suite declares
 * the step it trusts, as `suites.<name>.evidence`, and moves down when it is
 * ready. Nothing is recorded differently at any step; each is a reading of the
 * same record and the same graph.
 *
 * - `file` — a test runs when it imports a changed file, directly or through
 *   other files. The record says only which tests exist.
 * - `symbol` — the same walk, entering only the importers of the exports a
 *   change moved. A change that moved nothing a module does seeds nothing.
 * - `file-use` — a test runs when it loaded a changed file.
 * - `function-use` — a test runs when it entered the declaration a changed line
 *   is in. A line at the top level of a module is every test that loaded it.
 * - `region-use` — a test runs when it entered the region a changed line is in.
 *   This is what a suite that declares nothing reads.
 *
 * The steps trust different evidence, so a finer one is not always a subset of
 * a coarser one: `file-use` runs a test that only loaded the module, where
 * `symbol` does not, because a traced walk takes loading a module to declare
 * its exports and nothing else (`sideEffects` is the opt-out).
 */

import { affectedBy, idOf, trailOf, type Relations } from '@variance-authority/core/relate';
import type { TestCoverageView } from './format-view.js';
import type { ExecutionNarrowingOptions, ImporterReason } from './importers.js';
import { findTest, testPathOf, testsGovernedBy } from './lookup.js';
import { runsAsBefore } from './runs-as-before.js';
import type { ExecutionNarrowing, SelectionCause, SelectionReason } from './select.js';

/** The steps of evidence, coarsest first. */
export const EVIDENCE_STEPS = ['file', 'symbol', 'file-use', 'function-use', 'region-use'] as const;

/** One of {@link EVIDENCE_STEPS}. */
export type Evidence = (typeof EVIDENCE_STEPS)[number];

/** Whether `evidence` is answered by the import graph alone, with no region read. */
export function byRelations(evidence: Evidence | undefined): evidence is 'file' | 'symbol' {
  return evidence === 'file' || evidence === 'symbol';
}

/**
 * The recorded tests the import graph reaches from `changed`, each with the
 * chain that reached it.
 *
 * `moved` narrows the walk to the importers of the exports each file's change
 * moved; a file it does not name is walked whole, and so is every file when it
 * is absent.
 */
export function selectedByRelations(
  coverage: TestCoverageView,
  relations: Relations,
  changed: readonly string[],
  moved: ReadonlyMap<string, readonly string[]> | undefined,
): ReadonlyMap<number, readonly ImporterReason[]> {
  const affected = affectedBy(relations, changed, moved === undefined ? {} : { moved });
  const selected = new Map<number, ImporterReason[]>();
  for (const file of affected.files) {
    const test = findTest(coverage, file);
    if (test === undefined) continue;
    const trail = trailOf(affected.traversal, idOf(relations, 'file', file)!).map((id) => relations.names[id]!);
    selected.set(test, [{ kind: 'importer', trail }]);
  }
  return selected;
}

/**
 * Every block of the module holding `block` that shares its declaration: the
 * function a changed line is in. A block at the top level shares the module's
 * own region, which every test that loaded the module entered.
 */
export function declarationOf(coverage: TestCoverageView, block: number): readonly number[] {
  const module = moduleOf(coverage, block);
  const name = coverage.blockName.at(block);
  const blocks: number[] = [];
  for (let other = coverage.moduleBlocks.at(module); other < coverage.moduleBlocks.at(module + 1); other += 1) {
    if (coverage.blockName.at(other) === name) blocks.push(other);
  }
  return blocks;
}

/** The module row whose blocks hold `block`: `moduleBlocks` is ascending, so a binary search. */
function moduleOf(coverage: TestCoverageView, block: number): number {
  let low = 0;
  let high = coverage.moduleBlocks.length - 2;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (coverage.moduleBlocks.at(middle) <= block) low = middle;
    else high = middle - 1;
  }
  return low;
}

/**
 * A diff read by the import graph alone, at `file` or `symbol` evidence: every
 * recorded test the walk from the changed files reaches, and every test that
 * declares one of them. No region is read, so nothing is stale and no reading
 * is made. A changed file the graph does not hold and no test declares is
 * unread.
 */
export function readByRelations(
  coverage: TestCoverageView,
  changed: readonly string[],
  options: ExecutionNarrowingOptions,
): Required<Pick<ExecutionNarrowing, 'entered' | 'unread' | 'because' | 'stale' | 'readings'>> {
  const { relations } = options;
  if (relations === undefined) {
    throw new Error(`the suite trusts "${options.evidence}" evidence, which is read from the import graph, and no graph was handed over`);
  }
  const knownAs = options.knownAs ?? ((file: string): readonly string[] => [file]);
  const moved = options.evidence === 'symbol' ? (options.moved ?? movedSince(coverage.commit, changed, options.root)) : undefined;
  const selected = new Map<number, SelectionReason[]>();
  for (const [test, reasons] of selectedByRelations(coverage, relations, changed, moved)) selected.set(test, [...reasons]);
  const governed = testsGovernedBy(coverage, [...new Set(changed.flatMap(knownAs))]);
  for (const [test, held] of governed.tests) {
    const reasons = selected.get(test) ?? [];
    for (const name of held) reasons.push({ kind: 'precondition', name });
    selected.set(test, reasons);
  }
  const declared = new Set([...governed.tests.values()].flat());
  const because = [...selected]
    .map(([test, via]): SelectionCause => ({ test: testPathOf(coverage, test), via }))
    .sort((left, right) => codeUnitOrder(left.test, right.test));
  return {
    entered: because.map((cause) => cause.test),
    unread: changed.filter((file) => idOf(relations, 'file', file) === undefined && !knownAs(file).some((name) => declared.has(name))),
    stale: [],
    because,
    readings: [],
  };
}

/**
 * The exports each changed file moved since the commit the record names, read
 * from its text there and in the tree. Undefined when either is out of reach,
 * which walks every file whole.
 */
function movedSince(
  commit: string | undefined,
  changed: readonly string[],
  root: string | undefined,
): ReadonlyMap<string, readonly string[]> | undefined {
  if (commit === undefined || root === undefined) return undefined;
  // FIXME: the new side is the tree, so a diff between two commits — a stand's
  // — is narrowed by what the tree moved.
  const read = runsAsBefore(root, commit, changed);
  return 'moved' in read ? read.moved : undefined;
}

function codeUnitOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
