/**
 * Which test files a change needs, read off a journey file.
 *
 * The journey file is what `variance journeys finalize` and `journeys stitch`
 * write: every case, every region, and which cases entered it. It names no
 * commit and carries no text, so the change is whatever the caller hands in,
 * in the file's own coordinates — a diff from git, a diff from last week, a
 * diff nobody committed. Two shapes of change are read, by what they hold:
 *
 * - **Changed lines.** Each line is charged to the innermost region holding it,
 *   and the cases that entered that region are selected. That is the whole point
 *   of recording a journey: a branch one case took selects that case, not every
 *   case that imported the file.
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
 * reader applies (`ExecutionNarrowing.unread`).
 *
 * A package whose install moved changes no line anybody recorded. It is a node
 * in the graph, joined to the files that import it and to the packages that rest
 * on it, so the walk from it reaches every file whose imports lead there however
 * deep the bump sat: each test file it reaches runs, and so does every case the
 * record saw enter a module it reaches.
 */

import { affectedBy, type Relations } from '@variance-authority/core/relate';
import type { LineRange } from './diff-lines.js';
import { innermostAt, ownedIn, type ExecutionIndex, type ExecutionModule } from './reverse.js';
import type { ExecutionNarrowing } from './select.js';
import { shadowedFor } from './shadowed.js';

export interface JourneySelectionOptions {
  /**
   * The file graph. Without it a whole-file change and a load-time region are
   * answered by the cases the record saw enter the module, which misses a case
   * that only imported it.
   */
  readonly relations?: Relations;
  /** Packages whose installed version moved, by name. Heard only with `relations`. */
  readonly packages?: readonly string[];
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

  const importers = (file: string): readonly string[] | undefined => {
    if (relations === undefined) return undefined;
    const affected = affectedBy(relations, [file]);
    return affected.missing.length > 0 ? undefined : affected.files.filter((test) => held.has(test));
  };
  const everyEntrant = (module: ExecutionModule): void => {
    const own = ownedIn(index, module, owned);
    for (const block of module.blocks) {
      for (const crossing of block.crossings) if (own(crossing)) entered.add(index.tests[crossing.test]!.file);
    }
  };

  for (const [file, ranges] of changed) {
    if (held.has(file)) entered.add(file);
    const module = modules.get(file);

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
        for (const block of innermostAt(module.blocks, line)) {
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

  for (const name of options.packages ?? []) {
    if (relations === undefined) break;
    for (const file of affectedBy(relations, [{ kind: 'package', name }]).files) {
      if (held.has(file)) entered.add(file);
      const module = modules.get(file);
      if (module !== undefined) everyEntrant(module);
    }
  }

  return {
    whole: [...held].sort(codeUnitOrder),
    entered: [...entered].sort(codeUnitOrder),
    unread: unread.sort(codeUnitOrder),
    stale: [],
    because: [],
  };
}

function codeUnitOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
