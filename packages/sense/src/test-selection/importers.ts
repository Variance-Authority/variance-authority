import {
  EDGE_KINDS,
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
 * Answering a changed file that can hold no probe from the module that imports
 * it.
 *
 * The record decides. A module the build carried probes into has a row, and
 * the row says which tests entered it — or that none did, which is an answer
 * too. A module the build read but could not instrument has a row with nothing
 * behind it, and the tests that loaded it hold it as a precondition. A module
 * with no row at all the record never saw: nothing loaded it, every test that
 * imports it mocked it, or it sits outside what the recording instrumented — a
 * built file, a file the include left out — and the record cannot say which.
 * The first two answer. The third is a question the graph raised and nothing
 * answered, and the graph is an enrichment: it may add a selection and it may
 * never close a question it did not answer.
 *
 * A stylesheet, an image, a JSON file can hold no probe, so it never has a row,
 * and whether a test ran it is a question about the module that imported it.
 * The scan answers which files those are without anybody naming an extension:
 * an import of anything that is not a module is an `asset` edge, and a module
 * is never the target of one. So a changed file is walked to its dependents
 * through `asset` edges only. That reaches the stylesheets that import the
 * stylesheet and the modules that import those, and stops there by itself. A
 * module reached with a row selects every test that entered it; a module
 * reached without one leaves the changed file unmeasured, whatever the other
 * chains from it found, because one measured importer says nothing about the
 * importer beside it. A changed module has no `asset` edge into it, so the walk
 * from it reaches nothing, and the graph says nothing about it: its row does.
 *
 * A file whose own edges the scan could not read may import the asset by an
 * edge nobody saw. When the changed file is an asset, the walk starts at every
 * such file as well — as though that edge were in the graph — and what it
 * reaches is read like any chain: a row there selects its tests, and a chain
 * ending where the record never looked leaves the changed file unmeasured.
 * Asking the unreadable file alone for a row is not enough, and is unsafe: what
 * an asset walk passes through is stylesheets and images, which by the
 * paragraph above can hold no row at all, so an unreadable stylesheet would
 * answer nothing and unsettle nothing while a measured chain beside it closed
 * the question — and the test that renders through it would be skipped over a
 * change it carries.
 *
 * A test the snapshot says *holds* the changed file — it is a precondition of
 * the test, under any of its names — is left to the preconditions, which
 * already select it.
 *
 * What stays `unread` is a changed path the graph does not hold, a changed
 * file no chain leaves, and a changed file some chain leaves for a module the
 * record never saw. Nothing the graph holds is an answer until the record has
 * measured the end of it.
 */
export interface ExecutionNarrowingOptions {
  /**
   * The file graph a scan produced, so a changed file no probe can sit in is
   * answered by the module that imports it.
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
   * A name the graph does not hold is an answer, not a gap: nothing in this
   * repository imports it, so nothing it does can be observed here. A name it
   * holds whose importers the record never measured is `unread`, exactly as a
   * changed file in that position is.
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

/** Tests holding a set of names, and the names nothing recorded holds. */
export interface GovernedTests {
  /** Test row → the asked-for names it carries as preconditions. */
  readonly tests: ReadonlyMap<number, readonly string[]>;
  /** Asked-for names no test declared. */
  readonly unread: readonly string[];
}

const ASSET = EDGE_KINDS.indexOf('asset');

export function answerByImporters(
  coverage: TestCoverageView,
  changed: readonly string[],
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
  // finished naming every file worth asking the table about.
  const reached: Array<{
    readonly test: number;
    readonly reason: ImporterReason;
    readonly seed: readonly string[];
  }> = [];
  // A module the build read but could not instrument has a row with no blocks
  // and no crossings; the tests that loaded it hold it as a precondition, and
  // those are asked for by name once the walks are done.
  const governing = new Map<string, Array<{ readonly reason: ImporterReason; readonly seed: readonly string[] }>>();

  /**
   * Reads one file a walk reached, and says whether the record measured it: a
   * test row, a row with probes behind it however few tests crossed them, or
   * a row without probes, which is measured only if some test holds it and is
   * handed back as `deferred` until the table says.
   */
  const read = (
    id: NodeId,
    trail: readonly string[],
    seed: readonly string[],
  ): { readonly measured: boolean; readonly deferred: readonly string[] } => {
    const node = nodeAt(relations, id);
    if (node === undefined || node.kind !== 'file') return { measured: false, deferred: [] };
    const reason: ImporterReason = { kind: 'importer', trail };
    let measured = false;
    const deferred: string[] = [];
    for (const name of knownAs(node.name)) {
      const test = findTest(coverage, name);
      if (test !== undefined) {
        measured = true;
        reached.push({ test, reason, seed });
      }
      for (const module of findModules(coverage, name)) {
        if (coverage.moduleInstrumented.at(module) !== 1) {
          deferred.push(name);
          governing.set(name, [...(governing.get(name) ?? []), { reason, seed }]);
          continue;
        }
        measured = true;
        // A module's regions usually share one set, so the ids are deduplicated
        // before their members are: the repeat is the common case and reading it
        // again would be the whole module's crossings over again.
        const sets = new Set<number>();
        for (
          let block = coverage.moduleBlocks.at(module);
          block < coverage.moduleBlocks.at(module + 1);
          block += 1
        ) sets.add(coverage.blockSet.at(block));
        const seen = new Set<number>();
        for (const set of sets) {
          for (const entered of coverage.crossings.members(set)) {
            if (seen.has(entered)) continue;
            seen.add(entered);
            if (disowned?.(node.name, entered) === true) continue;
            reached.push({ test: entered, reason, seed });
          }
        }
      }
    }
    return { measured, deferred };
  };

  const opaque: NodeId[] = [];
  for (let id = 0; id < relations.unknown.length; id += 1) if (relations.unknown[id] === 1) opaque.push(id);
  const unread: string[] = [];
  // Files whose walks ended only at rows without probes, waiting on the one
  // read of the table below; every other file is settled as it is walked.
  const open: Array<{ readonly file: string; readonly chains: readonly (readonly string[])[] }> = [];
  for (const file of changed) {
    const id = idOf(relations, 'file', file);
    if (id === undefined) {
      unread.push(file);
      continue;
    }
    const seed = knownAs(file);
    // A file whose edges the scan could not read may import the asset by an
    // edge nobody saw, so when the changed file is an asset every such file is
    // a seed beside it: the walk continues from there exactly as it would have
    // done had the edge been in the graph, and everything it reaches is an end
    // of this file's question like any other.
    const reach = dependentsOf(
      relations,
      importedAsAsset(relations, id) ? [id, ...opaque] : [id],
      { through: ['asset'] },
    );
    // The question is answered when every chain from the file ends at something
    // the record measured. One chain ending where the record never looked
    // leaves the file unmeasured, whatever the other chains found.
    let ends = 0;
    let unmeasured = false;
    const chains: (readonly string[])[] = [];
    for (const other of reach.reached) {
      // The file itself, and a file something imports as an asset: the second
      // is a step on the way to the module that carries it, and the walk went
      // on through it.
      if (other === id || importedAsAsset(relations, other)) continue;
      // A trail that does not begin at the changed file begins at a file whose
      // edges nobody could read, and the step from the changed file to it is
      // the edge nobody saw: it is named, because a chain that starts in the
      // middle explains nothing.
      const trail = trailOf(reach, other);
      const named = (trail[0] === id ? trail : [id, ...trail]).map((step) => relations.names[step]!);
      const found = read(other, named, seed);
      ends += 1;
      if (found.measured) continue;
      if (found.deferred.length === 0) unmeasured = true;
      else chains.push(found.deferred);
    }
    // A file the graph holds and no chain leaves is not a file nobody uses; it
    // is a file the graph has nothing to say about, which is unread the same
    // way a file the graph does not hold is.
    if (ends === 0 || unmeasured) unread.push(file);
    else if (chains.length > 0) open.push({ file, chains });
  }

  // The same walk from the other end of the line. A package is a node like any
  // other and carries no row, so what the record can say about a bump is what
  // its importers say — and unlike an asset chain there is nothing further
  // along to be more precise, so every runtime edge is followed. A name the
  // graph does not hold reaches nothing and is not unread: nothing here imports
  // it.
  for (const name of moved) {
    const id = idOf(relations, 'package', name);
    if (id === undefined) continue;
    const reach = dependentsOf(relations, [id]);
    let ends = 0;
    let unmeasured = false;
    const chains: (readonly string[])[] = [];
    for (const other of reach.reached) {
      // Packages the walk passed through on its way up from a transitive
      // dependency, and the components a reached file declares: steps, not
      // ends. Only a file can have been measured.
      if (other === id || nodeAt(relations, other)?.kind !== 'file') continue;
      const named = trailOf(reach, other).map((step) => relations.names[step]!);
      const found = read(other, named, [name]);
      ends += 1;
      if (found.measured) continue;
      if (found.deferred.length === 0) unmeasured = true;
      else chains.push(found.deferred);
    }
    if (ends === 0) continue;
    if (unmeasured) unread.push(name);
    else if (chains.length > 0) open.push({ file: name, chains });
  }

  // The one read: which tests hold a changed file, which hold a module the
  // walks reached that carries no probes, and which hold a name the caller
  // could not answer from a row.
  const held = testsGovernedBy(coverage, [
    ...new Set([...changed.flatMap((file) => [...knownAs(file)]), ...governing.keys(), ...also]),
  ]);

  // A chain that ended at a row without probes is measured when some test
  // holds that row under one of its names, and one chain nobody holds leaves
  // the file unmeasured however many beside it were held.
  const unheld = new Set(held.unread);
  for (const { file, chains } of open) {
    if (chains.some((names) => names.every((name) => unheld.has(name)))) unread.push(file);
  }

  const selected = new Map<number, ImporterReason[]>();
  const keep = (test: number, reason: ImporterReason, seed: readonly string[]): void => {
    // A test that declares the changed file itself is already selected by its
    // preconditions, and a chain that reached it would only say so again.
    if ((held.tests.get(test) ?? []).some((name) => seed.includes(name))) return;
    const reasons = selected.get(test) ?? [];
    // One walk reaching a test through two rows of one module is one reason.
    if (reasons.includes(reason)) return;
    reasons.push(reason);
    selected.set(test, reasons);
  };
  for (const { test, reason, seed } of reached) keep(test, reason, seed);
  for (const [test, names] of held.tests) {
    for (const name of names) {
      for (const { reason, seed } of governing.get(name) ?? []) keep(test, reason, seed);
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

/** Whether anything imports this file as an asset, which is what a file no probe can sit in looks like to the scan. */
function importedAsAsset(relations: Relations, id: NodeId): boolean {
  const { offset, kind } = relations.dependents;
  for (let edge = offset[id]!; edge < offset[id + 1]!; edge += 1) if (kind[edge] === ASSET) return true;
  return false;
}

function codeUnitOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
