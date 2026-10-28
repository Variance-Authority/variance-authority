import {
  EDGE_KINDS, NOTHING, RUNTIME_EDGES, WHOLE, carried, dependentsOf, idOf, nodeAt, trailOf, type NodeId, type Relations,
} from '@variance-authority/core/relate';
import type { TestCoverageView } from './format-view.js';
import { findModules, findTest, testsGovernedBy } from './lookup.js';
import type { ExecutionNarrowingOptions } from './narrowing.js';
import type { Disowned } from './shadowed.js';

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
 * through `asset` edges only, which reaches the stylesheets that import it and
 * the modules that import those, and stops there by itself.
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
 * A file a moved value's reading could not read, holding no row and no test,
 * is walked the same way from itself (`wholes`): it may read or hand on the
 * value anywhere, and everything that imports it loads it, so every test that
 * loaded it is what can be said. A row without probes of its own is asked of
 * the table, as one on the way is.
 *
 * A test the snapshot says *holds* the changed file, under any of its names,
 * is left to the preconditions, which already select it.
 *
 * What stays `unread` is a changed path the graph does not hold: a report,
 * never a widening. A held file no measured chain leaves is connected to
 * nothing the suite ran — documentation, tooling, a fixture, a configuration.
 * What a harness loads without importing is the seam's to declare: every setup
 * file and every `preconditions` entry is a precondition of every test
 * (`vitest.ts`), and so is a fixture a test reads with `fs`.
 */
/** One chain of imports from a changed file or a moved package to the file whose row selected a test. */
export interface ImporterReason {
  readonly kind: 'importer';
  /** Changed file first, the module whose row answered last. */
  readonly trail: readonly string[];
}

export interface ImporterAnswer {
  /** Test rows selected, each with every chain that selected it. */
  readonly selected: ReadonlyMap<number, readonly ImporterReason[]>;
  /** Changed paths the graph does not hold; every one of them when there is no graph, or the suite declines it. */
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
  /** Test rows that loaded a file the caller asked to have answered whole → those files. */
  readonly wholes: ReadonlyMap<number, readonly string[]>;
  /** In a suite that declines relations, modules declaring an ignored file that no row holds and no test declares. */
  readonly unheld: readonly string[];
}

/** Tests holding a set of names, and the names no test declared. */
export interface GovernedTests {
  /** Test row → the asked-for names it carries as preconditions. */
  readonly tests: ReadonlyMap<number, readonly string[]>;
  /** Asked-for names no test declared. */
  readonly unread: readonly string[];
  /** Asked-for names every test declaring them ran over in the text they arrive at. */
  readonly ranOver: ReadonlySet<string>;
}

const ASSET = EDGE_KINDS.indexOf('asset');

/** What the caller asks the importer walk, beside the suite's options. */
export interface ImporterAsk {
  /** The changed files, under the names the change gives them, ignored ones included. */
  readonly changed: readonly string[];
  /**
   * The changed files the suite ignores (`ignoredChange`): walked through the
   * modules that declare they read them (`/// <depends>`), and through nothing else.
   */
  readonly ignored: ReadonlySet<string>;
  /**
   * Every name the caller answered from an instrumented row: a changed file
   * holding one under any of its names is the row's, and is not walked.
   */
  readonly rowed: ReadonlySet<string>;
  /**
   * The caller's `disownedIn` over the same coverage and `options.relations`:
   * a chain that ends at a module a test mocked does not reach that test, for
   * the reason a region of it does not (`shadowed.ts`).
   */
  readonly disowned: Disowned | undefined;
  /** Names the caller asks the precondition table about beside the walk's own (`ImporterAnswer.governed`). */
  readonly also?: ReadonlySet<string>;
  /** Every file the caller could not read and holds no row for, to be answered by every test that loaded it. */
  readonly wholes?: readonly string[];
  /**
   * The digest of the text each rowless changed name arrives at: a test that
   * ran that text is not governed by the name (`testsGovernedBy`).
   */
  readonly arrived?: ReadonlyMap<string, string>;
}

/** The walk from each changed file with no row to the nearest files the record holds, with the one read of the precondition table. */
export function answerByImporters(
  coverage: TestCoverageView,
  { changed, ignored: ignoring, rowed, disowned, also = new Set(), wholes = [], arrived = new Map() }: ImporterAsk,
  options: ExecutionNarrowingOptions,
): ImporterAnswer {
  const { relations } = options;
  // A suite that declines relations still follows what a module declares it reads of an ignored file.
  const declines = options.unmeasured === 'nothing';
  if (relations === undefined || changed.length + wholes.length === 0 || (declines && ignoring.size === 0)) {
    return { selected: new Map(), unread: changed.filter((file) => !ignoring.has(file)), governed: testsGovernedBy(coverage, [...also], arrived), wholes: new Map(), unheld: [] };
  }
  const knownAs = options.knownAs ?? ((file: string): readonly string[] => [file]);
  // Every test a walk reached, with what reached it — held rather than
  // selected, because whether the chain is worth reporting depends on the
  // preconditions the test carries, and those are not read until the walks have
  // finished naming every file worth asking the table about. `from` is the
  // changed module a runtime walk started at, for the mock cut; the other walks
  // leave it to the row. `whole` is the file a walk answering one whole began at.
  interface Reached {
    readonly reason: ImporterReason;
    readonly seed: readonly string[];
    readonly from: string | undefined;
    readonly whole?: string;
  }
  const reached: Array<Reached & { readonly test: number }> = [];
  // A module the build read but could not instrument has a row with no blocks
  // and no crossings; the tests that loaded it hold it as a precondition, and
  // those are asked for by name once the walks are done.
  const governing = new Map<string, Reached[]>();

  // What a file answers is the same whichever walk reached it — its rows under
  // the same names, their crossings, the mocks that disown them — and a file
  // behind many changed files is reached by every one of their walks. So it is
  // read once, and each walk replays the answer under its own trail.
  const answers = new Map<NodeId, FileAnswer>();

  /**
   * Reads one file a walk reached (`answerOf`), for the walk that reached it.
   *
   * True when a test or a row with probes answered, which is where a module's
   * chain stops.
   */
  const read = (
    id: NodeId,
    trail: readonly string[],
    seed: readonly string[],
    from: string | undefined,
    whole?: string,
  ): boolean => {
    const node = nodeAt(relations, id);
    if (node === undefined || node.kind !== 'file') return false;
    let answer = answers.get(id);
    if (answer === undefined) {
      answer = answerOf(coverage, knownAs(node.name), node.name, disowned);
      answers.set(id, answer);
    }
    const reason: ImporterReason = { kind: 'importer', trail };
    const entry: Reached = whole === undefined ? { reason, seed, from } : { reason, seed, from, whole };
    for (const test of answer.tests) reached.push({ test, ...entry });
    for (const name of answer.governs) {
      const entries = governing.get(name);
      if (entries === undefined) governing.set(name, [entry]);
      else entries.push(entry);
    }
    return answer.answered;
  };

  const unread: string[] = [];
  const readers: string[] = [];
  // One mark and one parent per node for every module walk, cleared behind each.
  const walk = {
    mask: new Uint8Array(relations.names.length),
    via: new Int32Array(relations.names.length).fill(-1),
  };
  for (const file of changed) {
    const id = idOf(relations, 'file', file);
    const ignored = ignoring.has(file);
    if (id === undefined || (declines && !ignored)) {
      if (!ignored) unread.push(file);
      continue;
    }
    const seed = knownAs(file);
    if (ignored || importedAsAsset(relations, id)) {
      // A module that declares it reads the file is a step to it as much as one that
      // imports it, and the one step an ignored file keeps: nothing else names it.
      const traversal = dependentsOf(relations, [id], { through: ignored ? ['depends'] : ['asset', 'depends'] });
      for (const other of traversal.nodes) {
        // The file itself, and an asset something imports: a step to the module that carries it, walked through.
        if (other === id || importedAsAsset(relations, other)) continue;
        const trail = trailOf(traversal, other).map((step) => relations.names[step]!);
        if (read(other, trail, seed, undefined) || !ignored || answers.get(other)?.governs.length !== 0) continue;
        // A reader of an ignored file no row holds goes where any unmeasured file goes: on to its importers, or named.
        const name = relations.names[other]!;
        for (const known of knownAs(name)) governing.set(known, [...(governing.get(known) ?? []), { reason: { kind: 'importer', trail }, seed, from: undefined }]);
        if (declines && !readers.includes(name)) readers.push(name);
        else if (!declines) importersUntil(relations, other, walk, (next, rest) => read(next, [...trail, ...rest.slice(1).map((step) => relations.names[step]!)], seed, name));
      }
    } else if (!seed.some((name) => rowed.has(name))) {
      importersUntil(relations, id, walk, (other, trail) =>
        read(other, trail.map((step) => relations.names[step]!), seed, file),
      );
    }
  }
  // A file answered whole is its own first step: a test that holds it, or a row
  // of it without probes, loaded it. No test declares it as a changed file, so
  // nothing is left to the preconditions.
  for (const file of declines ? [] : wholes) {
    const id = idOf(relations, 'file', file);
    if (id === undefined || read(id, [file], [], file, file)) continue;
    importersUntil(relations, id, walk, (other, trail) =>
      read(other, trail.map((step) => relations.names[step]!), [], file, file),
    );
  }

  // The one read: which tests hold a changed file, which hold a module the
  // walks reached that carries no probes, and which hold a name the caller
  // could not answer from a row.
  const held = testsGovernedBy(coverage, [
    ...new Set([...changed.flatMap((file) => [...knownAs(file)]), ...governing.keys(), ...also]),
  ], arrived);

  const selected = new Map<number, ImporterReason[]>();
  const whole = new Map<number, string[]>();
  const keep = (test: number, { reason, seed, from, whole: file }: Reached): void => {
    // A test that declares the changed file itself is already selected by its
    // preconditions, and a chain that reached it would only say so again.
    if ((held.tests.get(test) ?? []).some((name) => seed.includes(name))) return;
    // A test that mocked the changed module, or the file it loaded it through,
    // never ran it.
    if (from !== undefined && disowned?.(from, test) === true) return;
    if (file !== undefined) {
      const files = whole.get(test) ?? [];
      if (!files.includes(file)) whole.set(test, [...files, file]);
      return;
    }
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

  const unheld = readers.filter((name) => knownAs(name).every((known) => held.unread.includes(known)));
  return { selected, unread: unread.sort(codeUnitOrder), governed: asked(held, also), wholes: whole, unheld: unheld.sort(codeUnitOrder) };
}

/** What one file a walk reached answers, before a walk's trail is put on it. */
interface FileAnswer {
  /** A test or a row with probes answered, so a module's chain stops here. */
  readonly answered: boolean;
  /** Test rows reached, in the order they were read: each name's test row, then its rows' crossings. */
  readonly tests: readonly number[];
  /** Names of rows without probes, whose tests the precondition table names. */
  readonly governs: readonly string[];
}

/**
 * Reads one file under every name it may be held by: a test row, a row with
 * probes behind it however few tests crossed them, or a row without probes,
 * whose tests the table names once the walks are done. A name with none of
 * those selects nobody.
 *
 * `file` is the graph's name, the one shadows are written in.
 */
function answerOf(
  coverage: TestCoverageView,
  names: readonly string[],
  file: string,
  disowned: Disowned | undefined,
): FileAnswer {
  const tests: number[] = [];
  const governs: string[] = [];
  let answered = false;
  for (const name of names) {
    const test = findTest(coverage, name);
    if (test !== undefined) {
      tests.push(test);
      answered = true;
    }
    for (const module of findModules(coverage, name)) {
      if (coverage.moduleInstrumented.at(module) !== 1) {
        governs.push(name);
        continue;
      }
      answered = true;
      // A module's regions usually share one set, so the ids are deduplicated
      // before their members are: the repeat is the common case and reading it
      // again would be the whole module's crossings over again. The set a
      // block was loaded by rides along, because a load a mock explains is
      // disowned and a call is not, so each block that shares a set asks once.
      const sets = new Map<number, number>();
      for (let block = coverage.moduleBlocks.at(module); block < coverage.moduleBlocks.at(module + 1); block += 1) {
        const key = coverage.blockSet.at(block) * 0x1_0000_0000 + coverage.blockLoadedSet.at(block);
        if (!sets.has(key)) sets.set(key, block);
      }
      const seen = new Set<number>();
      for (const block of sets.values()) {
        for (const entered of coverage.crossings.members(coverage.blockSet.at(block))) {
          if (seen.has(entered)) continue;
          if (disowned?.(file, entered, block) === true) continue;
          seen.add(entered);
          tests.push(entered);
        }
      }
    }
  }
  return { answered, tests, governs };
}

/** The part of one read of the precondition table that answers a caller's own names. */
function asked(held: GovernedTests, names: ReadonlySet<string>): GovernedTests {
  const tests = new Map<number, readonly string[]>();
  for (const [test, carried] of held.tests) {
    const mine = carried.filter((name) => names.has(name));
    if (mine.length > 0) tests.set(test, mine);
  }

  return {
    tests,
    unread: held.unread.filter((name) => names.has(name)),
    ranOver: new Set([...held.ranOver].filter((name) => names.has(name))),
  };
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
  const traversal = { ...walk, nodes: [] };
  const { entered } = carried(
    relations.dependents,
    [[seed, WHOLE]],
    { hand: (node) => (answers(node, trailOf(traversal, node)) ? NOTHING : WHOLE) },
    { ...walk, through: RUNTIME_EDGES },
  );
  for (const node of entered) {
    walk.mask[node] = 0;
    walk.via[node] = -1;
  }
}

/** Whether anything imports this file as an asset, which is what a file no probe can sit in looks like to the scan. */
export function importedAsAsset(relations: Relations, id: NodeId): boolean {
  const { offset, kind } = relations.dependents;
  for (let edge = offset[id]!; edge < offset[id + 1]!; edge += 1) if (kind[edge] === ASSET) return true;
  return false;
}

function codeUnitOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
