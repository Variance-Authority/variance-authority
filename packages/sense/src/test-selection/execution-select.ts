/**
 * Which test files a change needs, read off a journey file.
 *
 * The journey file is what `variance journeys finalize` and `journeys stitch`
 * write: every case, every region, and which cases entered it. It names no
 * commit and carries no text, so the change is whatever the caller hands in,
 * in the file's own coordinates — a diff from git, a diff from last week, a
 * diff nobody committed. Two shapes of change are read, by what they hold:
 *
 * - **Changed lines.** Each line is charged by `chargeLine`, the rule
 *   `variance covering --line` answers by: the innermost region holding it, and
 *   the region around it too when the line opens a region and carries its text,
 *   as `if (ready) {` carries the condition. The cases that entered a charged
 *   region are selected. That is the whole point of recording a journey: a
 *   branch one case took selects that case, not every case that imported the
 *   file.
 * - **Changed files, no lines.** A path the diff names and shows nothing of is
 *   charged whole, and a whole file is answered by the file graph: every test
 *   file that imports it. So is a changed file with no row, and a region that
 *   ran while its module evaluated — the file records which case loaded it
 *   first, which is an import order and not a test, so the graph answers it.
 *
 * A file whose two texts were read is charged by what the reading proved
 * (`read`): `none` charges nothing, and `bodies` charges the regions its lines
 * fall in without the module's own, because nothing it does as it loads moved.
 * A comment above a function sits in the module's region, and without the
 * reading it is charged to every file that imports the module.
 *
 * A changed test file selects itself. A path neither the record nor the graph
 * knows selects nothing and is named in `unread`, by the rule the snapshot
 * reader applies (`ExecutionNarrowing.unread`). In a suite that declines
 * relations a file with no row is not asked of the graph at all, and is named
 * in `declined` instead, and a file the suite ignores is read by nothing and
 * named in `ignored` (`route.ts`).
 *
 * A bumped package arrives as the files that import it, changed whole
 * (`beyondReach`), and is answered as they are.
 */

import { RUNTIME_EDGES, affectedBy, dependentsOf, idOf, type Relations } from '@variance-authority/core/relate';
import { blocksChargedAt } from './blocks-around.js';
import type { LineRange } from './diff-lines.js';
import type { ExecutionIndex, ExecutionModule } from './reverse.js';
import type { ExecutionNarrowing } from './narrowing.js';
import { ignoredBy, routeOf, type Unmeasured } from './route.js';
import { ownedIn, shadowedFor } from './shadowed.js';

export interface JourneySelectionOptions {
  /**
   * The file graph. Without it a whole-file change and a load-time region are
   * answered by the cases the record saw enter the module, which misses a case
   * that only imported it.
   */
  readonly relations?: Relations;
  /**
   * What a changed file the journey holds no row for goes to: the test files
   * the graph says import it, or nothing (`route.ts`). Absent is `relations`.
   * A suite that declines them names such a file in `declined`, and a changed
   * test file it holds a case of still selects itself.
   */
  readonly unmeasured?: Unmeasured;
  /**
   * The suite's `ignore` globs (`route.ts`): a changed file one matches is
   * read by nothing and named in `ignored`. Absent ignores nothing.
   */
  readonly ignore?: readonly string[];
  /** What reading a changed file's two texts proved, by path (`readJourneyChange`). */
  readonly read?: ReadonlyMap<string, JourneyRead>;
}

/** What a reading proved about a changed file: nothing at runtime moved, or nothing at load. */
export type JourneyRead = 'none' | 'bodies';

/**
 * Narrow a change against a journey file, in the shape the snapshot reader
 * answers, so one skip list serves both.
 *
 * `changed` is `changedLines(diff)`: a path mapped to no ranges is a file named
 * whole. `whole` is every test file the journey file holds a case of.
 */
export function narrowByJourneys(
  index: ExecutionIndex,
  changed: ReadonlyMap<string, readonly LineRange[]>,
  options: JourneySelectionOptions = {},
): ExecutionNarrowing {
  const relations = options.relations;
  const owned = shadowedFor(relations);
  const modules = new Map(index.modules.map((module) => [module.file, module]));
  const held = new Set(index.tests.map((test) => test.file));
  const entered = new Set<string>();
  const unread: string[] = [];
  const declined: string[] = [];

  const importers = (file: string): readonly string[] | undefined => {
    if (relations === undefined) return undefined;
    const affected = affectedBy(relations, [file], { through: RUNTIME_EDGES });
    return affected.missing.length > 0 ? undefined : affected.files.filter((test) => held.has(test));
  };
  const everyEntrant = (module: ExecutionModule): void => enterEvery(index, module, owned, entered);

  const ignored = ignoredBy(options.ignore, changed.keys());
  const declared = declaredReach(index, relations, ignored, options.unmeasured);
  for (const test of declared.entered) entered.add(test);
  // A declaring file the record holds nothing for is named as any unread path is, or declined with them.
  (options.unmeasured === 'nothing' ? declined : unread).push(...declared.unread);
  const ignoring = new Set(ignored);
  for (const [file, ranges] of changed) {
    if (ignoring.has(file)) continue;
    if (held.has(file)) entered.add(file);
    const module = modules.get(file);

    if (module === undefined && options.unmeasured === 'nothing') {
      // A test file the record holds a case of selected itself above, which is
      // all the record says of a file it has no row for.
      if (routeOf(held.has(file), options.unmeasured) === 'nothing') declined.push(file);
      continue;
    }
    if (module === undefined || ranges.length === 0) {
      const byGraph = importers(file);
      for (const test of byGraph ?? []) entered.add(test);
      // The graph misses a module a browser spec reached through its page, so
      // the record's own entrants are added whenever it holds a row.
      if (module !== undefined) everyEntrant(module);
      else if (byGraph === undefined && !held.has(file)) unread.push(file);
      continue;
    }

    const read = options.read?.get(file);
    if (read === 'none') continue;
    const own = ownedIn(index, module, owned);
    let loaded = false;
    for (const range of ranges) {
      for (let line = range.start; line <= range.end; line += 1) {
        for (const block of blocksChargedAt(module.blocks, line)) {
          if (read === 'bodies' && block.kind === 'module') continue;
          if (block.loaded === true) loaded = true;
          for (const crossing of block.crossings) {
            if (own(crossing)) entered.add(index.tests[crossing.test]!.file);
          }
        }
      }
    }
    if (loaded) {
      const byGraph = importers(file);
      if (byGraph === undefined || byGraph.length === 0) everyEntrant(module);
      else for (const test of byGraph) entered.add(test);
    }
  }

  return {
    whole: [...held].sort(codeUnitOrder),
    entered: [...entered].sort(codeUnitOrder),
    unread: unread.sort(codeUnitOrder),
    ...(options.unmeasured === 'nothing' ? { declined: declined.sort(codeUnitOrder) } : {}),
    ...(options.ignore === undefined ? {} : { ignored }),
    stale: [],
  };
}

/** The modules that declare they read an ignored file (`/// <depends>`), by name. */
export function dependsReaders(relations: Relations | undefined, ignored: readonly string[]): readonly string[] {
  if (relations === undefined) return [];
  // Each file on its own: a reader the suite ignores as well still declared it reads another.
  const readers = ignored.flatMap((file) => {
    const id = idOf(relations, 'file', file);
    return id === undefined ? [] : [...dependentsOf(relations, [id], { through: ['depends'] }).nodes].filter((other) => other !== id);
  });
  return [...new Set(readers)].map((id) => relations.names[id]!);
}

/**
 * What an ignored file still reaches, read off the record alone: itself when it
 * is a test the record holds, and each module that declares it reads the file
 * by the cases the record saw enter it, or a test file by its own. The import
 * and asset edges into the file are what `ignore` cuts; a declaration was drawn
 * on purpose. A declaring file the record holds nothing for goes where any
 * unmeasured file goes: to the tests the graph says import it, or, in a suite
 * that declines relations or a graph that cannot answer, to `unread`.
 *
 * `index` holds the readers' modules: the whole journey, or its projection onto them.
 */
export function declaredReach(
  index: ExecutionIndex,
  relations: Relations | undefined,
  ignored: readonly string[],
  unmeasured?: Unmeasured,
): { readonly entered: readonly string[]; readonly unread: readonly string[] } {
  const held = new Set(index.tests.map((test) => test.file));
  const owned = shadowedFor(relations);
  const entered = new Set(ignored.filter((file) => held.has(file)));
  const unread: string[] = [];
  for (const reader of dependsReaders(relations, ignored)) {
    const module = index.modules.find((candidate) => candidate.file === reader);
    if (held.has(reader)) entered.add(reader);
    if (module !== undefined) enterEvery(index, module, owned, entered);
    if (held.has(reader) || module !== undefined) continue;
    const affected = relations === undefined || unmeasured === 'nothing' ? undefined : affectedBy(relations, [reader], { through: RUNTIME_EDGES });
    if (affected === undefined || affected.missing.length > 0) unread.push(reader);
    else for (const test of affected.files) if (held.has(test)) entered.add(test);
  }
  return { entered: [...entered], unread };
}

/** Adds every test file the record saw enter `module`, but for a case that mocked it. */
function enterEvery(index: ExecutionIndex, module: ExecutionModule, owned: ReturnType<typeof shadowedFor>, entered: Set<string>): void {
  const own = ownedIn(index, module, owned);
  for (const block of module.blocks) {
    for (const crossing of block.crossings) if (own(crossing)) entered.add(index.tests[crossing.test]!.file);
  }
}

function codeUnitOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
