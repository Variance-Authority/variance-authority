/**
 * A story read as a route: the declarations one case went through, in order.
 *
 * The tape is the territory, and the route is a map of it. It is drawn at the
 * grain of a declaration — the function, handler or top level a region belongs
 * to — because the question it answers first is *which parts of the system does
 * this case go through, and in what order*. So a run of visits inside one
 * declaration is one stop, a run of visits made while modules were evaluating
 * is one `loaded` stop naming the files, and a loop is drawn once. Coming back
 * to a caller stays a stop: it is what makes a loop's passes the same steps, so
 * what makes the loop fold.
 *
 * What happened inside a stop is carried on it rather than drawn as more
 * stops: how many times the declaration was entered, and every other region it
 * went into — an arm of an `if`, a loop's body — with how many times. A loop's
 * passes may take different arms and still fold, because the arms are what the
 * pass did inside the stop, not where the route went; a folded stop adds its
 * passes' counts together.
 *
 * What a declaration holds and the case never went into — anywhere in it,
 * before the case or during it — is carried once for the route, not on a stop:
 * `untaken`, each declaration's arms that no visit reached, a nested arm left
 * out when the arm around it is listed. It is the difference between the
 * regions the snapshot holds and the ones the tape names, so it is computed
 * here, where both are read, and nowhere else. An `else` nobody wrote is one of
 * them: never going into it says the condition held every time.
 *
 * A region is named from the coverage snapshot, which holds every recorded
 * module's regions by ordinal. A module whose regions the snapshot does not
 * hold with the count the story recorded — not recorded yet, or recorded from
 * another text — is still on the route, as its file, and is listed under
 * `unresolved`. It is never matched to a region by guess.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import type { BlockKind } from '../instrument/index.js';
import { askCoverageFile } from '../test-selection/coverage-file.js';
import { KINDS } from '../test-selection/format-layout.js';
import type { TestCoverageView } from '../test-selection/format-view.js';
import { findModules } from '../test-selection/lookup.js';
import { NO_LINE } from '../test-selection/written-lines.js';
import { recordOfStories, storyDirectories } from './directory.js';
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

/** A region inside a declaration that a stop went into, and how many times. */
export interface Arm {
  /** Where in the declaration it sits: `for#0/body/if#0/then`. */
  readonly path: string;
  readonly startLine?: number;
  readonly endLine?: number;
  readonly times: number;
}

/**
 * One stop on a route: a declaration, or modules evaluated one inside another.
 * `entered` counts the declaration's own region, so a stop the case came back
 * to from a callee without calling it again has entered it no times. `said` is
 * what the code said while the case was at the stop — a console line, an
 * announcement, what Eyes saw — in order; a folded stop says every pass's.
 */
export type Stop =
  | { readonly place: Place; readonly entered: number; readonly arms: readonly Arm[]; readonly said?: readonly string[] }
  | { readonly loaded: readonly string[]; readonly said?: readonly string[] };

/** The arms of one declaration on the route that the case never went into. */
export interface Untaken {
  readonly place: Place;
  readonly arms: readonly Omit<Arm, 'times'>[];
}

/** One case's route. */
export interface Route {
  /** The test file, relative to the checkout. */
  readonly file: string;
  readonly name: string;
  /** Where the code went between the last case and this one: hooks the runner ran outside the case. */
  readonly before: readonly Step<Stop>[];
  readonly route: readonly Step<Stop>[];
  /** What was said before the first step of each part, which no stop was there to hold. */
  readonly opening?: { readonly before?: readonly string[]; readonly route?: readonly string[] };
  /** Lines the recording did not keep; a route missing some of what was said says so. */
  readonly unnoted?: number;
  /** Every file the case went through, loaded or called, code-unit sorted. */
  readonly files: readonly string[];
  /** Files on the route the snapshot holds no matching regions for, so they are drawn as the file alone. */
  readonly unresolved: readonly string[];
  /** For each declaration the route stopped at, in the order first reached, the arms no visit went into; one with none is left out, and so is one in an unresolved file. */
  readonly untaken: readonly Untaken[];
  /** Visits the tape did not keep; a route that is missing its end says so. */
  readonly untaped: number;
  /** How many times another case's work ran in the middle of this one. */
  readonly interleaved: number;
  readonly stopped?: boolean;
}

/** One reading on disk, as a listing names it. */
export interface StoryEntry {
  readonly path: string;
  readonly file: string;
  readonly name: string;
  readonly visits: number;
  /** When the reading was written, in milliseconds since the epoch; absent on one written before readings were kept. */
  readonly written?: number;
  /** What the run called it: the value of `VARIANCE_AUTHORITY_STORY` when it was not `1`. */
  readonly label?: string;
  /** Whether the case threw or rejected in this reading; absent where the collector could not see it settle. */
  readonly stopped?: boolean;
}

/** Every reading in this checkout, by test file, then case name, then newest first. */
export function listStories(root: string): StoryEntry[] {
  const entries: StoryEntry[] = [];
  for (const directory of storyDirectories(root)) {
    if (!existsSync(directory)) continue;
    for (const name of readdirSync(directory)) {
      const reading = stories.readingOf(name);
      if (reading === undefined) continue;
      const path = join(directory, name);
      const story = stories.storyHeader(path);
      entries.push({
        path,
        file: inCheckout(root, story.file),
        name: story.name,
        visits: story.visits,
        ...(reading.written === undefined ? {} : { written: reading.written }),
        ...(reading.label === undefined ? {} : { label: reading.label }),
        ...(story.stopped === undefined ? {} : { stopped: story.stopped }),
      });
    }
  }
  return entries.sort((left, right) =>
    compare(left.file, right.file)
    || compare(left.name, right.name)
    || (right.written ?? 0) - (left.written ?? 0)
    || compare(left.path, right.path));
}

/** Every region a module holds by ordinal, for each row of `story`, where the snapshot beside it holds them. */
export function regionsOfStory(
  path: string,
  story: ReturnType<typeof stories.decodeStory>,
): { readonly files: readonly string[]; readonly regions: readonly (readonly Region[] | undefined)[] } {
  const files = story.rows.map(([id]) => id);
  const snapshot = recordOfStories(dirname(path));
  const regions = existsSync(snapshot)
    ? askCoverageFile(snapshot, (view) => story.rows.map(([, count], row) => regionsOf(view, files[row]!, count)))
    : story.rows.map(() => undefined);
  return { files, regions };
}

/** The route in the story at `path`, named through the record it was taped beside. */
export function readRoute(root: string, path: string): Route {
  const story = stories.decodeStory(readFileSync(path));
  const { files, regions } = regionsOfStory(path, story);
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
  const taken = new Set<number>();
  // Each declaration stopped at, by key, with the row its regions are in.
  const placed = new Map<string, { place: Place; row: number }>();

  const stopsOf = (visits: Int32Array, notes: readonly (readonly [number, string])[], opening: string[]): Stop[] => {
    const stops: Stop[] = [];
    let last = '';
    // The stop being added to, and its arms by path; a stop once left is never reopened.
    let open: { place: Place; entered: number; arms: Arm[] } | undefined;
    let paths = new Map<string, { times: number }>();
    let note = 0;
    // What was said after `visited` visits goes on the stop the last of them is on.
    const hear = (visited: number): void => {
      for (; note < notes.length && notes[note]![0] <= visited; note += 1) {
        const at = stops.at(-1) as { said?: string[] } | undefined;
        if (at === undefined) opening.push(notes[note]![1]);
        else (at.said ??= []).push(notes[note]![1]);
      }
    };
    let visited = 0;
    for (const entry of visits) {
      hear(visited);
      visited += 1;
      const index = entry & 0x7fffffff;
      taken.add(index);
      let row = bases.length - 1;
      while (bases[row]! > index) row -= 1;
      const file = shown[row]!;
      seen.add(file);
      if (entry & stories.EVALUATING) {
        const loading = stops.at(-1);
        if (loading !== undefined && 'loaded' in loading && last === '\0loaded') {
          if (!loading.loaded.includes(file)) (loading.loaded as string[]).push(file);
        } else stops.push({ loaded: [file] });
        open = undefined;
        last = '\0loaded';
        continue;
      }
      const own = regions[row];
      let place: Place;
      let region: Region | undefined;
      if (own === undefined) {
        unresolved.add(file);
        place = { file, name: '', kind: 'module' };
      } else {
        region = own[index - bases[row]!]!;
        place = declarations[row]!.get(region.name)!;
      }
      const key = `${place.file}\0${place.name}`;
      if (region !== undefined && !placed.has(key)) placed.set(key, { place, row });
      if (key !== last || open === undefined) {
        open = { place, entered: 0, arms: [] };
        paths = new Map();
        stops.push(open);
      }
      last = key;
      if (region === undefined || region.path === 'entry' || region.path === 'module') open.entered += 1;
      else {
        const arm = paths.get(region.path);
        if (arm !== undefined) arm.times += 1;
        else {
          const entered = {
            path: region.path,
            ...(region.startLine === undefined ? {} : { startLine: region.startLine, endLine: region.endLine }),
            times: 1,
          };
          paths.set(region.path, entered);
          open.arms.push(entered);
        }
      }
    }
    hear(Infinity);
    return stops;
  };
  const keyOf = (stop: Stop): string => ('loaded' in stop ? `\0${stop.loaded.join('\0')}` : `${stop.place.file}\0${stop.place.name}`);
  const opening = { before: [] as string[], route: [] as string[] };
  const before = foldSteps(stopsOf(story.before, story.beforeNotes, opening.before), keyOf, added);
  const route = foldSteps(stopsOf(story.visits, story.notes, opening.route), keyOf, added);

  const untaken: Untaken[] = [];
  for (const { place, row } of placed.values()) {
    const arms: Omit<Arm, 'times'>[] = [];
    regions[row]!.forEach((region, ordinal) => {
      if (region.name !== place.name || region.path === 'entry' || region.path === 'module') return;
      if (taken.has(bases[row]! + ordinal)) return;
      // An arm's regions come after the arm, so the one around it is already listed.
      if (arms.some((arm) => region.path.startsWith(`${arm.path}/`))) return;
      arms.push({
        path: region.path,
        ...(region.startLine === undefined ? {} : { startLine: region.startLine, endLine: region.endLine }),
      });
    });
    if (arms.length > 0) untaken.push({ place, arms });
  }

  return {
    file: inCheckout(root, story.file),
    name: story.name,
    before,
    route,
    files: [...seen].sort(compare),
    unresolved: [...unresolved].sort(compare),
    untaken,
    ...(opening.before.length + opening.route.length === 0 ? {} : {
      opening: {
        ...(opening.before.length === 0 ? {} : { before: opening.before }),
        ...(opening.route.length === 0 ? {} : { route: opening.route }),
      },
    }),
    ...(story.unnoted === 0 ? {} : { unnoted: story.unnoted }),
    untaped: story.untaped,
    interleaved: story.interleaved,
    ...(story.stopped === undefined ? {} : { stopped: story.stopped }),
  };
}

/** Two passes of one stop, as the one stop that stands for both. */
function added(kept: Stop, folded: Stop): Stop {
  const said = [...(kept.said ?? []), ...(folded.said ?? [])];
  const saying = said.length === 0 ? {} : { said };
  if ('loaded' in kept || 'loaded' in folded) return { ...kept, ...saying };
  const arms = new Map(kept.arms.map((arm) => [arm.path, arm]));
  for (const arm of folded.arms) {
    const known = arms.get(arm.path);
    arms.set(arm.path, known === undefined ? arm : { ...known, times: known.times + arm.times });
  }
  return { place: kept.place, entered: kept.entered + folded.entered, arms: [...arms.values()], ...saying };
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
export function declarationsOf(file: string, regions: readonly Region[]): Map<string, Place> {
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

export function inCheckout(root: string, file: string): string {
  return isAbsolute(file) ? relative(root, file) : file;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
