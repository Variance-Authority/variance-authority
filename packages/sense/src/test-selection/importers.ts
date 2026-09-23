import {
  EDGE_KINDS,
  RUNTIME_EDGES,
  dependentsOf,
  idOf,
  nodeAt,
  trailOf,
  type NodeId,
  type Relations,
} from '@variance-authority/core/relate';
import type { TestCoverageView } from './format-view.js';
import { findModules, findTest, testsGovernedBy } from './lookup.js';
import { disownedIn } from './shadowed.js';

/**
 * Answering a changed file the record holds no row for from the files that
 * import it.
 *
 * The record decides. A module the build put probes in has a row, and
 * the row says which tests entered it — or that none did, which is an answer
 * too. A module the build read but could not instrument has a row with nothing
 * behind it, and the tests that loaded it hold it as a precondition. A changed
 * file with no row of its own is a question about the files that import it.
 * The graph carries the question to a row; the row answers it.
 *
 * A stylesheet, an image, a JSON file can hold no probe, so it never has a row,
 * and whether a test ran it is a question about the module that imported it.
 * The scan answers which files those are without anybody naming an extension:
 * an import of anything that is not a module is an `asset` edge, and a module
 * is never the target of one. So a changed file is walked to its dependents
 * through `asset` edges only. That reaches the stylesheets that import the
 * stylesheet and the modules that import those, and stops there by itself.
 * Each module reached answers for itself: one with a row selects every test
 * that entered it, one without selects nobody, and neither changes what the
 * chain beside it selects.
 *
 * A changed module with no instrumented row under any of its names — one the
 * recording did not instrument, or one new since it — is walked to its
 * importers over every edge a runtime loads through, and never over `type`: an
 * erased import loads nothing. Each chain stops at the first file the record
 * holds as a test or as an instrumented row. The row answers for everything
 * behind it, because every test that loaded the changed module through that
 * file evaluated it and crossed its module block; a test file answers for
 * itself. A row with no probes behind it measured nothing, so its tests are
 * asked of the table and the chain goes on past it. A chain that reaches
 * nothing the record holds selects nothing, and takes nothing from the chain
 * beside it. A test that mocked the changed module, or a file between it and
 * the row, is cut there (`shadowed.ts`), as it is from a region.
 *
 * A file whose own edges the scan could not read may import the changed file
 * by an edge nobody saw. The walk does not start there: that edge is the
 * record's to answer, and where the record has no row to answer it with, the
 * edge is absent, which selects nothing.
 *
 * A test the snapshot says *holds* the changed file — it is a precondition of
 * the test, under any of its names — is left to the preconditions, which
 * already select it.
 *
 * What stays `unread` is a changed path the graph does not hold, and it is a
 * report, never a widening. A file the graph holds that no measured chain
 * leaves is connected to nothing the suite ran, and mostly for a reason — it
 * is documentation, tooling, a fixture, a configuration. What a harness loads
 * without importing is not this walk's to find: the Vitest seam writes every
 * setup file the configuration names, and every file its `preconditions`
 * option lists, as a precondition of every test (`vitest.ts`), so a change to
 * one selects the whole suite through the table. A configuration file nothing
 * imports is declared the same way, and so is a fixture a test reads with `fs`.
 */
export interface ExecutionNarrowingOptions {
  /**
   * The file graph a scan produced, so a changed file with no instrumented row
   * is answered by the nearest files that import it and have one.
   */
  readonly relations?: Relations;
  /**
   * Packages whose installed version moved, by name.
   *
   * The far end of the same line. A bumped dependency is not a changed path —
   * the lockfile that records it is one, and it is the wrong one: a workspace
   * version rewrite repaints hundreds of its lines and moves no installed
   * byte, while a transitive bump three levels down moves real code and may
   * touch no line a diff would show as interesting. So the install is compared
   * at the two revisions and what arrives here is the answer: these packages
   * are not the packages that were there.
   *
   * A package has no row of its own — nothing instrumented `node_modules` —
   * so it is answered the way an asset is, by walking to the files that import
   * it. Unlike an asset that walk follows every runtime edge, because there is
   * no row further along to be more precise than it: the question *which tests
   * entered a module that imports this* is the whole of what the record can
   * say. `type` edges are not walked, so `import type { Theme } from '@mui/material'`
   * selects nothing on a `@mui/material` bump, which is right — the import is
   * erased before anything runs.
   *
   * A name is never `unread`. One the graph does not hold is imported by
   * nothing here, and one whose importers the record never measured is
   * imported by nothing the suite ran: either way nothing it does can be
   * observed here, and it selects nobody. Each measured importer answers for
   * itself, however many beside it were never measured.
   *
   * Names, not instances. Which copy of a package a resolver handed a
   * particular importer is not answerable without reproducing that resolver,
   * and a selector that guessed would skip on the guess.
   */
  readonly packages?: readonly string[];
  /**
   * Every name the snapshot may hold a graph file under. Identity when absent.
   *
   * A package's own tests load its `src`; every other package loads its built
   * output, and the snapshot records each name as its own row. Both rows are one
   * file to the graph, which knows only the source name, so a changed file and
   * every importer reached from it are looked up under every name given here.
   */
  readonly knownAs?: (file: string) => readonly string[];
  /**
   * A module's source as it stood at the position the snapshot names, so the
   * line ranges the snapshot holds can be checked against the ones the diff is
   * written in.
   *
   * A recording cuts its line ranges from the text on disk at the moment the
   * suite ran, and labels the whole snapshot with `git rev-parse HEAD`. Those
   * two agree only when the tree was clean, and a suite is *recorded by being
   * run*: in the loop this is most wanted in — a developer's, an agent's — the
   * tree is never clean, so the ranges are the working tree's and the label
   * says the commit's. Every hunk a later diff produces is then charged to
   * whatever region happens to occupy those numbers now, which is a different
   * region, belonging to different tests, or to none.
   *
   * Given this, each changed module is asked for its text at the commit on the
   * label and the answer is hashed against `modules.source`, which the recorder
   * already wrote for exactly this text. A module whose two do not agree is
   * charged whole — its own crossings, the widest honest answer — and named in
   * `stale`. Without this the frame is taken on trust, and a caller that skips
   * anything on that trust is trusting a number nobody checked.
   *
   * `undefined` for a file the commit does not hold is the same disagreement:
   * the snapshot has a row for a file that did not exist there.
   */
  readonly sourceAt?: (file: string, commit: string | undefined) => string | undefined;
}

/** One chain of imports from a changed file or a moved package to the file whose row selected a test. */
export interface ImporterReason {
  readonly kind: 'importer';
  /** Changed file first, the module whose row answered last. */
  readonly trail: readonly string[];
}

export interface ImporterAnswer {
  /** Test rows selected, each with every chain that selected it. */
  readonly selected: ReadonlyMap<number, readonly ImporterReason[]>;
  /** Changed paths the graph does not hold; every one of them when there is no graph. */
  readonly unread: readonly string[];
  /**
   * The tests holding the names the caller asked about beside this question,
   * from the one read of the precondition table this made.
   *
   * The caller has a question of the same shape — which tests declare the
   * changed files that had no instrumented row — and asking it on its own asks
   * the same table again. That table is a row per test per precondition, so on
   * a repository of any size it is the largest thing a snapshot holds that is
   * not a crossing, and reading it is very nearly the whole cost of the query:
   * a hundred million rows, two seconds, and a hundred and forty megabytes,
   * against three milliseconds for the same question asked about a module. Two
   * of the three questions here need it and so does the caller's, so it is read
   * once for every name any of them names, and each is handed back only the
   * names it asked for.
   */
  readonly governed: GovernedTests;
}

/** Tests holding a set of names, and the names no test declared. */
export interface GovernedTests {
  /** Test row → the asked-for names it carries as preconditions. */
  readonly tests: ReadonlyMap<number, readonly string[]>;
  /** Asked-for names no test declared. */
  readonly unread: readonly string[];
}

const ASSET = EDGE_KINDS.indexOf('asset');
/** The edge kinds a runtime loads through, as a byte lookup over `EDGE_KINDS`. */
const LOADS = new Uint8Array(EDGE_KINDS.length);
for (const kind of RUNTIME_EDGES) LOADS[EDGE_KINDS.indexOf(kind)] = 1;

/**
 * `rowed` is every name the caller answered from an instrumented row: a changed
 * file holding one under any of its names is the row's, and is not walked.
 */
export function answerByImporters(
  coverage: TestCoverageView,
  changed: readonly string[],
  rowed: ReadonlySet<string>,
  options: ExecutionNarrowingOptions,
  also: ReadonlySet<string> = new Set(),
): ImporterAnswer {
  const { relations } = options;
  const moved = options.packages ?? [];
  if (relations === undefined || (changed.length === 0 && moved.length === 0)) {
    return { selected: new Map(), unread: changed, governed: testsGovernedBy(coverage, [...also]) };
  }
  const knownAs = options.knownAs ?? ((file: string): readonly string[] => [file]);
  // A chain that ends at a module a test mocked does not reach
  // that test, for the reason a region of it does not (`shadowed.ts`).
  const disowned = disownedIn(coverage, relations);
  // Every test a walk reached, with what reached it — held rather than
  // selected, because whether the chain is worth reporting depends on the
  // preconditions the test carries, and those are not read until the walks have
  // finished naming every file worth asking the table about. `from` is the
  // changed module a runtime walk started at, for the mock cut; the other walks
  // leave it to the row.
  interface Reached {
    readonly reason: ImporterReason;
    readonly seed: readonly string[];
    readonly from: string | undefined;
  }
  const reached: Array<Reached & { readonly test: number }> = [];
  // A module the build read but could not instrument has a row with no blocks
  // and no crossings; the tests that loaded it hold it as a precondition, and
  // those are asked for by name once the walks are done.
  const governing = new Map<string, Reached[]>();

  /**
   * Reads one file a walk reached under every name it may be held by: a test
   * row, a row with probes behind it however few tests crossed them, or a row
   * without probes, whose tests the table names once the walks are done. A
   * name with none of those selects nobody.
   *
   * True when a test or a row with probes answered, which is where a module's
   * chain stops.
   */
  const read = (
    id: NodeId,
    trail: readonly string[],
    seed: readonly string[],
    from: string | undefined,
  ): boolean => {
    const node = nodeAt(relations, id);
    if (node === undefined || node.kind !== 'file') return false;
    const reason: ImporterReason = { kind: 'importer', trail };
    let answered = false;
    for (const name of knownAs(node.name)) {
      const test = findTest(coverage, name);
      if (test !== undefined) {
        reached.push({ test, reason, seed, from });
        answered = true;
      }
      for (const module of findModules(coverage, name)) {
        if (coverage.moduleInstrumented.at(module) !== 1) {
          governing.set(name, [...(governing.get(name) ?? []), { reason, seed, from }]);
          continue;
        }
        answered = true;
        // A module's regions usually share one set, so the ids are deduplicated
        // before their members are: the repeat is the common case and reading it
        // again would be the whole module's crossings over again. The set a
        // block was loaded by rides along, because a load a mock explains is
        // disowned and a call is not, so each block that shares a set asks once.
        const sets = new Map<number, number>();
        for (
          let block = coverage.moduleBlocks.at(module);
          block < coverage.moduleBlocks.at(module + 1);
          block += 1
        ) {
          const key = coverage.blockSet.at(block) * 0x1_0000_0000 + coverage.blockLoadedSet.at(block);
          if (!sets.has(key)) sets.set(key, block);
        }
        const seen = new Set<number>();
        for (const block of sets.values()) {
          for (const entered of coverage.crossings.members(coverage.blockSet.at(block))) {
            if (seen.has(entered)) continue;
            if (disowned?.(node.name, entered, block) === true) continue;
            seen.add(entered);
            reached.push({ test: entered, reason, seed, from });
          }
        }
      }
    }
    return answered;
  };

  const unread: string[] = [];
  // One mark and one parent per node for every module walk, cleared behind each.
  const walk = {
    mask: new Uint8Array(relations.names.length),
    via: new Int32Array(relations.names.length).fill(-1),
  };
  for (const file of changed) {
    const id = idOf(relations, 'file', file);
    if (id === undefined) {
      unread.push(file);
      continue;
    }
    const seed = knownAs(file);
    if (importedAsAsset(relations, id)) {
      const traversal = dependentsOf(relations, [id], { through: ['asset'] });
      for (const other of traversal.nodes) {
        // The file itself, and a file something imports as an asset: the second
        // is a step on the way to the module that carries it, and the walk went
        // on through it.
        if (other === id || importedAsAsset(relations, other)) continue;
        read(other, trailOf(traversal, other).map((step) => relations.names[step]!), seed, undefined);
      }
    } else if (!seed.some((name) => rowed.has(name))) {
      importersUntil(relations, id, walk, (other, trail) =>
        read(other, trail.map((step) => relations.names[step]!), seed, file),
      );
    }
  }

  // The same walk from the other end of the line. A package is a node like any
  // other and carries no row, so what the record can say about a bump is what
  // its importers say — and unlike an asset chain there is nothing further
  // along to be more precise, so every runtime edge is followed. A name the
  // graph does not hold reaches nothing: nothing here imports it.
  for (const name of moved) {
    const id = idOf(relations, 'package', name);
    if (id === undefined) continue;
    const traversal = dependentsOf(relations, [id]);
    for (const other of traversal.nodes) {
      // Packages the walk passed through on its way up from a transitive
      // dependency, and the components a reached file declares: steps, not
      // ends. Only a file can have been measured.
      if (other === id || nodeAt(relations, other)?.kind !== 'file') continue;
      read(other, trailOf(traversal, other).map((step) => relations.names[step]!), [name], undefined);
    }
  }

  // The one read: which tests hold a changed file, which hold a module the
  // walks reached that carries no probes, and which hold a name the caller
  // could not answer from a row.
  const held = testsGovernedBy(coverage, [
    ...new Set([...changed.flatMap((file) => [...knownAs(file)]), ...governing.keys(), ...also]),
  ]);

  const selected = new Map<number, ImporterReason[]>();
  const keep = (test: number, { reason, seed, from }: Reached): void => {
    // A test that declares the changed file itself is already selected by its
    // preconditions, and a chain that reached it would only say so again.
    if ((held.tests.get(test) ?? []).some((name) => seed.includes(name))) return;
    // A test that mocked the changed module, or the file it loaded it through,
    // never ran it.
    if (from !== undefined && disowned?.(from, test) === true) return;
    const reasons = selected.get(test) ?? [];
    // One walk reaching a test through two rows of one module is one reason.
    if (reasons.includes(reason)) return;
    reasons.push(reason);
    selected.set(test, reasons);
  };
  for (const entry of reached) keep(entry.test, entry);
  for (const [test, names] of held.tests) {
    for (const name of names) {
      for (const entry of governing.get(name) ?? []) keep(test, entry);
    }
  }

  return { selected, unread: unread.sort(codeUnitOrder), governed: asked(held, also) };
}

/** The part of one read of the precondition table that answers a caller's own names. */
function asked(held: GovernedTests, names: ReadonlySet<string>): GovernedTests {
  if (names.size === 0) return { tests: new Map(), unread: [] };

  const tests = new Map<number, readonly string[]>();
  for (const [test, carried] of held.tests) {
    const mine = carried.filter((name) => names.has(name));
    if (mine.length > 0) tests.set(test, mine);
  }

  return { tests, unread: held.unread.filter((name) => names.has(name)) };
}

/**
 * Breadth-first over the files that load `seed`, stopping each chain at the
 * first node `answers` says the record holds.
 *
 * `dependentsOf` walks the whole closure, and past a row there is nothing to
 * ask: everything behind it loaded the row's module, and its tests are the
 * row's. Breadth-first for the reason `dependentsOf` is — the trail is then a
 * shortest one — and `trailOf` reads it off the same marks.
 */
function importersUntil(
  relations: Relations,
  seed: NodeId,
  walk: { readonly mask: Uint8Array; readonly via: Int32Array },
  answers: (id: NodeId, trail: readonly NodeId[]) => boolean,
): void {
  const { offset, target, kind } = relations.dependents;
  const queue: NodeId[] = [seed];
  const traversal = { ...walk, nodes: queue };
  walk.mask[seed] = 1;
  for (let head = 0; head < queue.length; head += 1) {
    const node = queue[head]!;
    if (node !== seed && answers(node, trailOf(traversal, node))) continue;
    for (let edge = offset[node]!; edge < offset[node + 1]!; edge += 1) {
      const next = target[edge]!;
      if (LOADS[kind[edge]!] !== 1 || walk.mask[next] === 1) continue;
      walk.mask[next] = 1;
      walk.via[next] = node;
      queue.push(next);
    }
  }
  for (const node of queue) {
    walk.mask[node] = 0;
    walk.via[node] = -1;
  }
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
