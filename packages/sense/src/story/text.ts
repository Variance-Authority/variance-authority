// compass: variance-authority.reach.story
/**
 * A route as the text a reader reads: every step a line, the arms it took
 * drawn under it as the code is nested, and what was said there under that,
 * `» handed name=value`; or, at a coarser level, the packages, files or
 * declarations it went through with the steps it was there. `variance story`
 * draws a test's route by it, and `variance ask ran --story` an execution's,
 * so a step and what it was handed read the same in both.
 */

import type { Place, Route, Untaken } from './read.js';
import type { Drawing, FileSteps, PackageVisits, Through } from './levels.js';
import { armTree } from './tree.js';
import { numbered, type FileVisits, type Gap, type Line } from './view.js';

/** Every step of a route, numbered, with the arms it took and what was said there, blank line first. */
export function routeText(route: Route): string[] {
  const lines = numbered(route);
  const steps = lines.filter((line) => line.step !== undefined).length;
  const text: string[] = [];
  linesText(lines, route.before.length > 0, String(steps).length, route.untaken, armStarts(lines, route.untaken), text);
  return text;
}

/** What the tape lost of a route's visits, said when it lost any. */
export function untapedText(route: Route): string[] {
  return route.untaped > 0 ? [`the recording filled up, and ${route.untaped} later visits are not on this route`] : [];
}

/** What the tape lost of the lines said on a route, printed and handed alike, said when it lost any. */
export function unnotedText(route: Route): string[] {
  return route.unnoted === undefined ? [] : [`the recording kept its first lines said, and ${route.unnoted} later ones are not on this route`];
}

/** The files a route is drawn through as the file alone, said when there are any. */
export function unresolvedText(route: Route): string[] {
  const files = route.unresolved.length;
  if (files === 0) return [];
  return [`${files} ${files === 1 ? 'file is' : 'files are'} drawn as the file alone: the recording holds no regions for ${files === 1 ? 'it' : 'them'} at this text`];
}

/** A drawing as the lines of text it reads as, blank line first. */
export function drawingText(drawing: Drawing, sections: boolean, width: number, untaken: readonly Untaken[], starts: Starts): string[] {
  const text: string[] = [];
  switch (drawing.level) {
    case 'packages': packagesText(drawing.packages, text); break;
    case 'files': filesText(drawing.files, text); break;
    case 'declarations': overviewText(drawing.visits, text); break;
    default: linesText(drawing.lines, sections, width, untaken, starts, text);
  }
  return text;
}


/** Lines said before a part's first step, or at one step, listed before the rest are counted. */
const SAID = 5;

function packagesText(packages: readonly PackageVisits[], text: string[]): void {
  text.push('');
  for (const each of packages) {
    const files = `${each.files} ${each.files === 1 ? 'file' : 'files'}`;
    text.push(`  ${each.package}${each.own ? "  the test's own" : ''}  ${files}, ${stepList(each.steps)}`);
  }
}

function filesText(files: readonly FileSteps[], text: string[]): void {
  const grouped = new Set(files.map((file) => file.package)).size > 1;
  let home: string | undefined;
  text.push('');
  for (const file of files) {
    if (grouped && (file.package !== home || text.length === 1)) text.push(`  ${file.package ?? '(no package)'}`);
    home = file.package;
    const loaded = file.loadedAt === undefined ? [] : [`loaded at step ${file.loadedAt}`];
    const steps = file.steps.length === 0 ? [] : [stepList(file.steps)];
    text.push(`  ${grouped ? '  ' : ''}${file.file}  ${[...loaded, ...steps].join(', ')}`);
  }
}

function overviewText(files: readonly FileVisits[], text: string[]): void {
  for (const file of files) {
    text.push('', `  ${file.file}${file.loadedAt === undefined ? '' : `  loaded at step ${file.loadedAt}`}`);
    for (const visit of file.declarations) {
      const where = lineRange(visit);
      const name = where === '' ? '(the file alone)' : `${where}  ${declaration(visit)}`;
      text.push(`    ${name}  ${stepList(visit.steps, visit.passes)}`);
    }
  }
}

function linesText(
  lines: readonly (Line | Gap | Through)[],
  sections: boolean,
  width: number,
  untaken: readonly Untaken[],
  starts: Starts,
  text: string[],
): void {
  const names = shortNames(lines);
  const never = new Map(untaken.map(({ place: at, arms }) => [at.at, arms]));
  text.push('', ...filesIn(names), '');
  let before: boolean | undefined;
  const blank = ' '.repeat(width);
  lines.forEach((line) => {
    if ('gap' in line) {
      const indent = '  '.repeat(line.depth);
      const [from, to] = line.gap;
      text.push(`  ${blank}  ${indent}… ${from === to ? `step ${from}` : `steps ${from}-${to}`} left out`);
      return;
    }
    if (sections && line.before !== before) text.push(line.before ? '  before the test' : '  the test');
    before = line.before;
    const indent = '  '.repeat(line.depth);
    if ('through' in line) {
      const [from, to] = line.steps;
      text.push(`  ${String(from).padStart(width)}  ${indent}through ${line.through}, steps ${from}-${to}: ${named(line.names)}`);
      return;
    }
    const stop = line.stop;
    if (stop === undefined) {
      const [from, to] = line.span ?? [0, 0];
      const steps = from === to ? `step ${from}` : `steps ${from}-${to}`;
      text.push(`  ${blank}  ${indent}${steps} ran ${line.times ?? 0} times in all:`);
      return;
    }
    const number = String(line.step).padStart(width);
    if ('loaded' in stop) {
      text.push(`  ${number}  ${indent}${loaded(stop.loaded.map((file) => names.get(file) ?? file))}`);
    } else {
      text.push(`  ${number}  ${indent}${placeText(stop.place, stop.entered, names)}`);
      const key = stop.place.at;
      const tree = armTree(stop.arms, never.get(key) ?? [], starts.get(key) ?? new Map());
      for (const branch of tree) text.push(`  ${blank}  ${indent}  ${branch}`);
    }
    if (stop.said !== undefined) text.push(...saidText(stop.said, `  ${blank}  ${indent}  `));
  });
}

/** What was said, one `»` line each: the first {@link SAID} printed and the first {@link SAID} handed, counted apart, then a count of the rest. */
export function saidText(said: readonly string[], indent: string): string[] {
  const seen = { printed: 0, handed: 0 };
  const kind = (line: string) => (line.startsWith('handed ') || line.startsWith('holds ') ? 'handed' : 'printed');
  const shown = said.filter((line) => seen[kind(line)]++ < SAID).map((line) => `${indent}» ${line}`);
  const rest = said.length - shown.length;
  return rest > 0 ? [...shown, `${indent}» and ${rest} more ${rest === 1 ? 'line' : 'lines'}`] : shown;
}

/** The line each arm of each declaration starts on, from every step on the route that took it and every arm it never took. */
export type Starts = ReadonlyMap<string, ReadonlyMap<string, number>>;

/** Where each arm the route took or never took starts, by declaration, so a step's arms are named by the line they start on. */
export function armStarts(lines: readonly Line[], untaken: readonly Untaken[]): Starts {
  const starts = new Map<string, Map<string, number>>();
  const add = (at: Place, arms: readonly { readonly path: string; readonly startLine?: number }[]) => {
    const key = at.at;
    const known = starts.get(key) ?? starts.set(key, new Map()).get(key)!;
    for (const arm of arms) if (arm.startLine !== undefined) known.set(arm.path, arm.startLine);
  };
  for (const { stop } of lines) if (stop !== undefined && 'place' in stop) add(stop.place, stop.arms);
  for (const { place: at, arms } of untaken) add(at, arms);
  return starts;
}

/**
 * Each file a drawing names, by its shortest trailing part that no other file
 * there shares: a basename, and a directory more when two basenames collide.
 */
function shortNames(lines: readonly (Line | Gap | Through)[]): Map<string, string> {
  const files = new Set<string>();
  for (const line of lines) {
    if ('gap' in line || 'through' in line || line.stop === undefined) continue;
    if ('loaded' in line.stop) for (const file of line.stop.loaded) files.add(file);
    else files.add(line.stop.place.file);
  }
  const names = new Map<string, string>();
  for (const file of files) {
    const parts = file.split('/');
    let take = 1;
    while (take < parts.length && [...files].some((other) => other !== file && other.endsWith(`/${parts.slice(-take).join('/')}`))) take += 1;
    names.set(file, parts.slice(-take).join('/'));
  }
  return names;
}

/** The files a drawing names, grouped by the directory their short names leave off: `in packages/core/src: hash.ts, merkle.ts`. */
function filesIn(names: ReadonlyMap<string, string>): string[] {
  const directories = new Map<string, string[]>();
  for (const [file, name] of names) {
    const directory = file.slice(0, file.length - name.length).replace(/\/$/, '') || '.';
    (directories.get(directory) ?? directories.set(directory, []).get(directory)!).push(name);
  }
  const width = Math.max(...[...directories.keys()].map((directory) => directory.length));
  return [...directories].map(([directory, files], at) =>
    `  ${at === 0 ? 'in' : '  '} ${`${directory}:`.padEnd(width + 1)} ${files.join(', ')}`);
}

/** A declaration by name, then where it is, and how many times it was entered when more than once. */
function placeText(place: Place, entered: number, names: ReadonlyMap<string, string>): string {
  const file = names.get(place.file) ?? place.file;
  const where = lineRange(place);
  return where === '' ? `${file}${count(entered)}` : `${declaration(place)}  ${file}:${where}${count(entered)}`;
}

/** `×N` for a count over one; nothing for once. */
function count(times: number): string {
  return times > 1 ? ` ×${times}` : '';
}

function lineRange({ startLine, endLine }: { readonly startLine?: number; readonly endLine?: number }): string {
  if (startLine === undefined) return '';
  return startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`;
}

function declaration({ name, kind }: { readonly name: string; readonly kind: Place['kind'] }): string {
  const named = name === '' ? '(top level)' : name;
  return kind === 'function' || kind === 'module' ? named : `${named}  ${kind}`;
}

/** Runs of steps a package or a file lists before the rest are counted; a declaration lists every one. */
const LISTED = 6;

/**
 * Steps in order, consecutive ones as a range: `steps 3-5, 9, 12-14`. With
 * `passes`, a step inside a repeat carries how many times it went round,
 * `39×6`, and every step is listed.
 */
function stepList(steps: readonly number[], passes?: readonly number[]): string {
  if (steps.length === 1) return `step ${steps[0]}${passes === undefined ? '' : count(passes[0]!).trim()}`;
  const runs: [number, number, number][] = [];
  steps.forEach((step, at) => {
    const times = passes?.[at] ?? 1;
    const last = runs.at(-1);
    if (last !== undefined && step === last[1] + 1 && times === last[2]) last[1] = step;
    else runs.push([step, step, times]);
  });
  const shown = passes === undefined ? runs.slice(0, LISTED) : runs;
  const rest = steps.length - shown.reduce((sum, [from, to]) => sum + to - from + 1, 0);
  const listed = shown.map(([from, to, times]) => `${from === to ? from : `${from}-${to}`}${count(times).trim()}`).join(', ');
  return `steps ${listed}${rest > 0 ? `, and ${rest} more steps` : ''}`;
}

const SHOWN = 3;

function named(names: readonly string[]): string {
  const shown = names.slice(0, SHOWN).join(', ');
  return `${shown}${names.length > SHOWN ? `, and ${names.length - SHOWN} more` : ''}`;
}

function loaded(files: readonly string[]): string {
  const named = files.slice(0, SHOWN).join(', ');
  const more = files.length > SHOWN ? `, and ${files.length - SHOWN} more` : '';
  return `loaded ${files.length} ${files.length === 1 ? 'file' : 'files'}: ${named}${more}`;
}
