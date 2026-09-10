import {
  EDGE_KINDS,
  dependentsOf,
  idOf,
  nodeAt,
  trailOf,
  type NodeId,
  type Relations,
} from '@variance-authority/core';
import type { TestCoverageView } from './format.js';
import { findModule, findTest, testsGovernedBy } from './lookup.js';

/**
 * Answering a changed file that can hold no probe from the module that imports
 * it.
 *
 * The record decides. A module the build carried probes into has a row, and
 * the row says which tests entered it. A module with no row was executed by
 * nobody the record can see: every test that imports it mocked it, or nothing
 * loaded it at all, and a test that imports a module that was mocked never ran
 * a line of anything behind the mock. Such a file selects nobody, and so does
 * everything only it imports. That is the dead branch, and no graph revives it.
 *
 * A stylesheet, an image, a JSON file can hold no probe, so it never has a row,
 * and whether a test ran it is a question about the module that imported it.
 * The scan answers which files those are without anybody naming an extension:
 * an import of anything that is not a module is an `asset` edge, and a module
 * is never the target of one. So a changed file is walked to its dependents
 * through `asset` edges only. That reaches the stylesheets that import the
 * stylesheet and the modules that import those, and stops there by itself. A
 * module reached with a row selects every test that entered it; a module
 * reached without one is dead. A changed module has no `asset` edge into it,
 * so the walk from it reaches nothing, which is the same answer.
 *
 * A file whose own edges the scan could not read may import the asset by an
 * edge nobody saw. When the changed file is an asset, every such file with a
 * row selects its tests as well, so the answer is wider than the diff and never
 * narrower.
 *
 * A test the snapshot says *holds* the changed file — it is a precondition of
 * the test, under any of its names — is left to the preconditions, which
 * already select it.
 *
 * What stays `unread` is a changed path the graph does not hold: a file
 * outside the directories the scan was pointed at, or a caller with no graph.
 */
export interface ExecutionNarrowingOptions {
  /**
   * The file graph a scan produced, so a changed file no probe can sit in is
   * answered by the module that imports it.
   */
  readonly relations?: Relations;
  /**
   * Every name the snapshot may hold a graph file under. Identity when absent.
   *
   * A package's own tests load its `src`; every other package loads its built
   * output, and the snapshot records each name as its own row. Both rows are one
   * file to the graph, which knows only the source name, so a changed file and
   * every importer reached from it are looked up under every name given here.
   */
  readonly knownAs?: (file: string) => readonly string[];
}

/** One chain of `asset` imports from a changed file to the module whose row selected a test. */
export interface ImporterReason {
  readonly kind: 'importer';
  /** Changed file first, the module whose row answered last. */
  readonly trail: readonly string[];
}

export interface ImporterAnswer {
  /** Test rows selected, each with every chain that selected it. */
  readonly selected: ReadonlyMap<number, readonly ImporterReason[]>;
  /** Changed paths the graph does not hold. */
  readonly unread: readonly string[];
}

const ASSET = EDGE_KINDS.indexOf('asset');

export function answerByImporters(
  coverage: TestCoverageView,
  changed: readonly string[],
  options: ExecutionNarrowingOptions,
): ImporterAnswer {
  const { relations } = options;
  if (relations === undefined || changed.length === 0) return { selected: new Map(), unread: changed };
  const knownAs = options.knownAs ?? ((file: string): readonly string[] => [file]);
  const selected = new Map<number, ImporterReason[]>();
  // Which tests hold which changed file, by the preconditions each carries.
  const held = testsGovernedBy(coverage, changed.flatMap((file) => [...knownAs(file)])).tests;
  const select = (test: number, reason: ImporterReason, seed: readonly string[]): void => {
    if ((held.get(test) ?? []).some((name) => seed.includes(name))) return;
    const reasons = selected.get(test) ?? [];
    reasons.push(reason);
    selected.set(test, reasons);
  };
  // A module the build read but could not instrument has a row with no blocks
  // and no crossings; the tests that loaded it hold it as a precondition, and
  // those are asked for by name once the walks are done.
  const governing = new Map<string, Array<{ readonly reason: ImporterReason; readonly seed: readonly string[] }>>();

  const read = (id: NodeId, trail: readonly string[], seed: readonly string[]): void => {
    const node = nodeAt(relations, id);
    if (node === undefined || node.kind !== 'file') return;
    const reason: ImporterReason = { kind: 'importer', trail };
    for (const name of knownAs(node.name)) {
      const test = findTest(coverage, name);
      if (test !== undefined) select(test, reason, seed);
      const module = findModule(coverage, name);
      if (module === undefined) continue;
      if (coverage.moduleInstrumented[module] !== 1) {
        governing.set(name, [...(governing.get(name) ?? []), { reason, seed }]);
        continue;
      }
      const seen = new Set<number>();
      for (
        let crossing = coverage.blockTests[coverage.moduleBlocks[module]!]!;
        crossing < coverage.blockTests[coverage.moduleBlocks[module + 1]!]!;
        crossing += 1
      ) {
        const entered = coverage.crossingTest[crossing]!;
        if (seen.has(entered)) continue;
        seen.add(entered);
        select(entered, reason, seed);
      }
    }
  };

  const opaque: NodeId[] = [];
  for (let id = 0; id < relations.unknown.length; id += 1) if (relations.unknown[id] === 1) opaque.push(id);
  const unread: string[] = [];
  for (const file of changed) {
    const id = idOf(relations, 'file', file);
    if (id === undefined) {
      unread.push(file);
      continue;
    }
    const seed = knownAs(file);
    const reach = dependentsOf(relations, [id], { through: ['asset'] });
    for (const reached of reach.reached) {
      if (reached === id) continue;
      read(reached, trailOf(reach, reached).map((step) => relations.names[step]!), seed);
    }
    if (!importedAsAsset(relations, id)) continue;
    for (const other of opaque) {
      if (reach.mask[other] !== 1) read(other, [file, relations.names[other]!], seed);
    }
  }

  const governed = testsGovernedBy(coverage, [...governing.keys()]);
  for (const [test, names] of governed.tests) {
    for (const name of names) {
      for (const { reason, seed } of governing.get(name)!) select(test, reason, seed);
    }
  }

  return { selected, unread: unread.sort(codeUnitOrder) };
}

/** Whether anything imports this file as an asset, which is what a file no probe can sit in looks like to the scan. */
function importedAsAsset(relations: Relations, id: NodeId): boolean {
  const { offset, kind } = relations.dependents;
  for (let edge = offset[id]!; edge < offset[id + 1]!; edge += 1) if (kind[edge] === ASSET) return true;
  return false;
}

function codeUnitOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
