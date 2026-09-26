/**
 * A story read as a route: the declarations one case went through, in order.
 *
 * The tape is the territory, and the route is a map of it. It is drawn at the
 * grain of a declaration — the function, handler or top level a region belongs
 * to — because the question it answers is *which parts of the system does this
 * case go through, and in what order*, not which arm of which `if` it took on
 * the forty-first pass. So a run of visits inside one declaration is one stop,
 * a run of visits made while modules were evaluating is one `loaded` stop
 * naming the files, and a loop is drawn once. Coming back to a caller stays a
 * stop: it is what makes a loop's passes the same steps, so what makes the
 * loop fold.
 *
 * A region is named from the coverage snapshot, which holds every recorded
 * module's regions by ordinal. A module whose regions the snapshot does not
 * hold with the count the story recorded — not recorded yet, or recorded from
 * another text — is still on the route, as its file, and is listed under
 * `unresolved`. It is never matched to a region by guess.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import type { BlockKind } from '../instrument/index.js';
import { readModuleNames } from '../module-names.js';
import { askCoverageFile } from '../test-selection/coverage-file.js';
import { KINDS } from '../test-selection/format-layout.js';
import type { TestCoverageView } from '../test-selection/format-view.js';
import { testCoverageFile } from '../test-selection/index.js';
import { moduleNamesFile } from '../test-selection/instrumented-modules.js';
import { findModules } from '../test-selection/lookup.js';
import { NO_LINE } from '../test-selection/written-lines.js';
import { storyDirectory } from './directory.js';
import { foldSteps, type Step } from './fold.js';
import stories from './format.cjs';

/** A declaration a route goes through. */
export interface Place {
  readonly file: string;
  /** The declaration's name path, `Cart/removeItem`; empty for the module's top level. */
  readonly name: string;
  readonly kind: BlockKind;
  readonly startLine?: number;
  readonly endLine?: number;
}

/** One stop on a route: a declaration, or modules evaluated one inside another. */
export type Stop = { readonly place: Place } | { readonly loaded: readonly string[] };

/** One case's route. */
export interface Route {
  /** The test file, relative to the checkout. */
  readonly file: string;
  readonly name: string;
  /** Where the code went between the last case and this one: hooks the runner ran outside the case. */
  readonly before: readonly Step<Stop>[];
  readonly route: readonly Step<Stop>[];
  /** Every file the case went through, loaded or called, code-unit sorted. */
  readonly files: readonly string[];
  /** Files on the route the snapshot holds no matching regions for, so they are drawn as the file alone. */
  readonly unresolved: readonly string[];
  /** Visits the tape did not keep; a route that is missing its end says so. */
  readonly untaped: number;
  /** How many times another case's work ran in the middle of this one. */
  readonly interleaved: number;
  readonly stopped?: boolean;
}

/** A story on disk, as a listing names it. */
export interface StoryEntry {
  readonly path: string;
  readonly file: string;
  readonly name: string;
  readonly visits: number;
}

/** Every story in this checkout, by test file and then case name. */
export function listStories(root: string): StoryEntry[] {
  const directory = storyDirectory(root);
  if (!existsSync(directory)) return [];
  const entries: StoryEntry[] = [];
  for (const name of readdirSync(directory)) {
    if (!name.endsWith('.story')) continue;
    const path = join(directory, name);
    const story = stories.decodeStory(readFileSync(path));
    entries.push({ path, file: inCheckout(root, story.file), name: story.name, visits: story.visits.length });
  }
  return entries.sort((left, right) => compare(left.file, right.file) || compare(left.name, right.name));
}

/** The route in the story at `path`, named through this checkout's recording. */
export function readRoute(root: string, path: string): Route {
  const story = stories.decodeStory(readFileSync(path));
  const names = existsSync(moduleNamesFile(root)) ? readModuleNames(moduleNamesFile(root)) : undefined;
  const files = story.rows.map(([id]) => (typeof id === 'string' ? id : names?.pathOf(id) ?? `module ${id}`));
  const snapshot = testCoverageFile(root);
  const regions = existsSync(snapshot)
    ? askCoverageFile(snapshot, (view) => story.rows.map(([, count], row) => regionsOf(view, files[row]!, count)))
    : story.rows.map(() => undefined);
  return drawRoute(root, story, files, regions);
}

/** A region as the snapshot holds it, by ordinal. */
export interface Region {
  readonly kind: BlockKind;
  readonly name: string;
  /** The structure inside the declaration: `entry` or `module` on the declaration's own region. */
  readonly path: string;
  readonly startLine?: number;
  readonly endLine?: number;
}

/** The route of a decoded story whose rows are `files`, each module's regions by ordinal where known. */
export function drawRoute(
  root: string,
  story: ReturnType<typeof stories.decodeStory>,
  files: readonly string[],
  regions: readonly (readonly Region[] | undefined)[],
): Route {
  const bases: number[] = [];
  let total = 0;
  for (const [, count] of story.rows) {
    bases.push(total);
    total += count;
  }
  const shown = files.map((file) => inCheckout(root, file));
  const declarations = regions.map((own, row) => (own === undefined ? undefined : declarationsOf(shown[row]!, own)));
  const seen = new Set<string>();
  const unresolved = new Set<string>();

  const stopsOf = (visits: Int32Array): Stop[] => {
    const stops: Stop[] = [];
    let last = '';
    for (const entry of visits) {
      const index = entry & 0x7fffffff;
      let row = bases.length - 1;
      while (bases[row]! > index) row -= 1;
      const file = shown[row]!;
      seen.add(file);
      if (entry & stories.EVALUATING) {
        const open = stops.at(-1);
        if (open !== undefined && 'loaded' in open && last === '\0loaded') {
          if (!open.loaded.includes(file)) (open.loaded as string[]).push(file);
        } else stops.push({ loaded: [file] });
        last = '\0loaded';
        continue;
      }
      const own = regions[row];
      let place: Place;
      if (own === undefined) {
        unresolved.add(file);
        place = { file, name: '', kind: 'module' };
      } else {
        const region = own[index - bases[row]!]!;
        place = declarations[row]!.get(region.name)!;
      }
      const key = `${place.file}\0${place.name}`;
      if (key !== last) stops.push({ place });
      last = key;
    }
    return stops;
  };
  const keyOf = (stop: Stop): string => ('loaded' in stop ? `\0${stop.loaded.join('\0')}` : `${stop.place.file}\0${stop.place.name}`);

  return {
    file: inCheckout(root, story.file),
    name: story.name,
    before: foldSteps(stopsOf(story.before), keyOf),
    route: foldSteps(stopsOf(story.visits), keyOf),
    files: [...seen].sort(compare),
    unresolved: [...unresolved].sort(compare),
    untaped: story.untaped,
    interleaved: story.interleaved,
    ...(story.stopped === undefined ? {} : { stopped: story.stopped }),
  };
}

/**
 * A module's regions by ordinal, from the snapshot row whose region count is
 * the one the story recorded. A source and its build can be recorded under one
 * path, so the count is what tells them apart.
 */
function regionsOf(view: TestCoverageView, file: string, count: number): Region[] | undefined {
  // TODO: carry the module's source digest on the story's rows and match on
  // it; two texts of one path with the same region count are told apart by
  // nothing here.
  for (const row of findModules(view, file)) {
    const first = view.moduleBlocks.at(row);
    const end = view.moduleBlocks.at(row + 1);
    if (end - first !== count) continue;
    const regions = Array.from<Region>({ length: count });
    for (let block = first; block < end; block += 1) {
      const start = view.blockStart.at(block);
      regions[view.blockOrdinal.at(block)] = {
        kind: KINDS[view.blockKind.at(block)]!,
        name: view.string(view.blockName.at(block)),
        path: view.string(view.blockPath.at(block)),
        ...(start === NO_LINE ? {} : { startLine: start, endLine: view.blockEnd.at(block) }),
      };
    }
    if (regions.every((region) => region !== undefined)) return regions;
  }
  return undefined;
}

/**
 * Each declaration in a module by name, drawn by its own region: a function's
 * `entry`, or the `module` region for the top level. A name whose own region
 * the module does not hold is drawn by the first region it has.
 */
function declarationsOf(file: string, regions: readonly Region[]): Map<string, Place> {
  const out = new Map<string, Place>();
  const drawn = new Set<string>();
  for (const region of regions) {
    const own = region.path === 'entry' || region.path === 'module';
    if (drawn.has(region.name) || (out.has(region.name) && !own)) continue;
    if (own) drawn.add(region.name);
    out.set(region.name, {
      file,
      name: region.name,
      kind: region.kind,
      ...(region.startLine === undefined ? {} : { startLine: region.startLine, endLine: region.endLine }),
    });
  }
  return out;
}

function inCheckout(root: string, file: string): string {
  return isAbsolute(file) ? relative(root, file) : file;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
