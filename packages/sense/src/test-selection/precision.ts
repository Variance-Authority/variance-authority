// compass: variance-authority.reach
/**
 * How precisely a suite's selection decides which tests to skip.
 *
 * Selection reads one record, the regions each test entered, and the import
 * graph beside it. A team that adopts it rarely trusts the finest reading on
 * the first day: a skipped test is a cost they cannot see. So a suite declares
 * the step it trusts as `suites.<name>.precision`, and moves down when it is
 * ready. Nothing is recorded differently at any step; each is a reading of the
 * same record and the same graph.
 *
 * - `file` — a test runs when it imports a changed file, directly or through
 *   other files, or when it loaded one.
 * - `symbol` — the same walk, entering only the importers of the exports a
 *   change moved, and every test that loaded a changed file.
 * - `file-use` — a test runs when it loaded a changed file.
 * - `function-use` — a test runs when it entered the declaration a changed line
 *   is in. The top level is read as at `region-use`, and each region that
 *   reading charges is widened to its function: a changed value is every test
 *   that entered a function reading it, and a change that runs as the module
 *   loads is every test that loaded the file.
 * - `region-use` — a test runs when it entered the region a changed line is in.
 *   This is what a suite that declares nothing reads.
 *
 * Each step runs every test a finer one runs. The graph and the record trust
 * different evidence — a traced walk takes loading a module to declare its
 * exports and nothing else, and a runner's setup file loads a module no import
 * names — so `file` and `symbol` add what the walk reaches to what `file-use`
 * reads rather than replace it.
 */

import { extname } from 'node:path';
import { RUNTIME_EDGES, affectedBy, idOf, trailOf, type Relations } from '@variance-authority/core/relate';
import { codeUnitOrder } from '@variance-authority/core/segment';
import { native } from '../addon.js';
import { MODULE_EXTENSIONS } from '../read.js';
import { kindId, NO_OWNER } from './format-layout.js';
import type { TestCoverageView } from './format-view.js';
import type { ImporterReason } from './importers.js';
import type { ExecutionNarrowingOptions } from './narrowing.js';
import { findTest, testPathOf } from './lookup.js';
import { applied, type Hunk } from './patch.js';
import { textAtRecording } from './recorded-text.js';
import type { ExecutionNarrowing, SelectionCause, SelectionReason } from './narrowing.js';

/** The steps of precision, coarsest first. */
export const PRECISION_STEPS = ['file', 'symbol', 'file-use', 'function-use', 'region-use'] as const;

/** One of {@link PRECISION_STEPS}. */
export type Precision = (typeof PRECISION_STEPS)[number];

/** Whether `precision` adds what the import graph reaches to the `file-use` reading. */
export function byRelations(precision: Precision | undefined): precision is 'file' | 'symbol' {
  return precision === 'file' || precision === 'symbol';
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
  const affected = affectedBy(relations, changed, {
    through: RUNTIME_EDGES,
    ...(moved === undefined ? {} : { moved }),
  });
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
 * Every block of the declaration a changed line is in: the nearest function
 * that owns `block`, followed up the owner chain, and the regions it holds that
 * no nearer function owns. A block at the top level is the module's own
 * region, which every test that loaded the module entered.
 */
export function declarationOf(coverage: TestCoverageView, block: number): readonly number[] {
  const module = moduleOf(coverage, block);
  const first = coverage.moduleBlocks.at(module);
  const end = coverage.moduleBlocks.at(module + 1);
  const byOrdinal = new Map<number, number>();
  for (let one = first; one < end; one += 1) byOrdinal.set(coverage.blockOrdinal.at(one), one);
  const nearest = (from: number): number => {
    let at = from;
    while (!DECLARATIONS.has(coverage.blockKind.at(at))) {
      const owner = coverage.blockOwner.at(at);
      const next = owner === NO_OWNER ? undefined : byOrdinal.get(owner);
      if (next === undefined) return at;
      at = next;
    }
    return at;
  };
  const declaration = nearest(block);
  const blocks: number[] = [];
  for (let one = first; one < end; one += 1) if (nearest(one) === declaration) blocks.push(one);
  return blocks;
}

/** The kinds of region a declaration opens: a function, and the module's top level. */
const DECLARATIONS = new Set([kindId('module'), kindId('function')]);

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
 * The record's reading at `file-use` with what the import graph adds at `file`
 * or `symbol`: every recorded test the walk from the changed files reaches,
 * with the chain that reached it beside the reasons the reading gave. What is
 * unread the reading already said: it asked the same graph.
 */
export function withGraph<Reading extends Required<Pick<ExecutionNarrowing, 'entered' | 'because'>>>(
  coverage: TestCoverageView,
  reading: Reading,
  changed: readonly string[],
  hunks: ReadonlyMap<string, readonly Hunk[]>,
  options: ExecutionNarrowingOptions,
): Reading {
  const { relations } = options;
  if (relations === undefined) {
    throw new Error(`the suite selects at "${options.precision}" precision, which is read from the import graph, and no graph was handed over`);
  }
  const moved = options.precision === 'symbol' ? (options.moved ?? movedBy(coverage.commit, changed, hunks, options)) : undefined;
  const via = new Map<string, SelectionReason[]>(reading.because.map((cause) => [cause.test, [...cause.via]]));
  for (const [test, reasons] of selectedByRelations(coverage, relations, changed, moved)) {
    const path = testPathOf(coverage, test);
    via.set(path, [...(via.get(path) ?? []), ...reasons]);
  }
  const because = [...via]
    .map(([test, reasons]): SelectionCause => ({ test, via: reasons }))
    .sort((left, right) => codeUnitOrder(left.test, right.test));
  return {
    ...reading,
    entered: because.map((cause) => cause.test),
    because,
  };
}

/**
 * The exports each changed file's diff moved, read from the text the record
 * holds and that text with the diff's hunks applied: the diff's own two sides,
 * whatever the tree holds. A file with no hunk, whose text is out of reach,
 * whose hunks do not apply, or that is not a module is left out and walked
 * whole; so is every file
 * when nothing can read a module.
 */
function movedBy(
  commit: string | undefined,
  changed: readonly string[],
  hunks: ReadonlyMap<string, readonly Hunk[]>,
  options: ExecutionNarrowingOptions,
): ReadonlyMap<string, readonly string[]> | undefined {
  const verdict = native()?.moduleVerdict;
  const before = options.sourceAt ?? (options.root === undefined ? undefined : textAtRecording(options.root, changed));
  if (verdict === undefined || before === undefined) return undefined;
  const moved = new Map<string, readonly string[]>();
  for (const file of changed) {
    const its = hunks.get(file);
    if (its === undefined || its.length === 0 || !MODULE_EXTENSIONS.includes(extname(file))) continue;
    const old = before(file, commit);
    const patched = old === undefined ? undefined : applied(old, its);
    const exports = patched === undefined ? undefined : verdict(file, old!, patched.after)?.moved;
    if (exports !== undefined) moved.set(file, exports);
  }
  return moved;
}
