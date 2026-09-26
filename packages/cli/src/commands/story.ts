/**
 * The route one case took through the code.
 *
 * `covering` answers *which tests went here*; this answers the question from
 * the other end, for one test: *where does this case go, and in what order*.
 * It reads a story, which a run writes under `VARIANCE_AUTHORITY_STORY=1`, and
 * prints it as a route through declarations — the functions, handlers and top
 * levels the case passed through, a loop drawn once with how many times it went
 * round, modules loaded along the way named as one stop, and at each stop the
 * arms and loop bodies it went into.
 *
 * How much of it is shown is picked from how much there is: `story-levels.ts`
 * draws the part asked for from its packages down to every step and reads the
 * finest that fits. A long route is narrowed a part at a time — the steps
 * through one package or file, or around one step — and `story-view.ts` says
 * why a step number, and not a caller, is what joins the parts.
 *
 * Who runs the case is not this command's business. Any runner with the seam
 * installed writes a story for every case it runs under the variable, and
 * narrowing the run is the runner's own flag.
 */

import {
  listStories,
  readRoute,
  STORY_VARIABLE,
  type Place,
  type Route,
  type StoryEntry,
  type Untaken,
} from '@variance-authority/sense/story';
import { OperatorError } from '../exit.js';
import { packageName, packageOf } from '../package-home.js';
import type { ParsedStory, StoryZoom } from '../story-args.js';
import { BUDGET, drawings, pick, type Drawing, type FileSteps, type PackageVisits, type Through } from './story-levels.js';
import { armTree } from './story-tree.js';
import { inFile, numbered, window, type FileVisits, type Gap, type Line } from './story-view.js';

/** One route and how much of it to read, or the stories to choose from when the flags name more than one. */
export type StoryAnswer =
  | {
    readonly route: Route;
    readonly zoom?: StoryZoom;
    /** The package each file on the route and the test's own file is in, by its manifest; a file under none is absent. */
    readonly packages?: Readonly<Record<string, string>>;
  }
  | { readonly stories: readonly StoryEntry[] };

/** The story the flags name, read as a route; every candidate when they name several. */
export function story(parsed: ParsedStory): StoryAnswer {
  const all = listStories(parsed.root);
  if (all.length === 0) {
    throw new OperatorError(
      `no story in this checkout: run the case with ${STORY_VARIABLE}=1, and the runner writes one for every case it runs`,
    );
  }
  const matching = all.filter(
    (entry) =>
      (parsed.file === undefined || entry.file.includes(parsed.file))
      && (parsed.name === undefined || entry.name.includes(parsed.name)),
  );
  if (matching.length === 0) {
    const asked = [parsed.file && `--file ${parsed.file}`, parsed.name && `--name ${parsed.name}`].filter(Boolean);
    throw new OperatorError(`no story matches ${asked.join(' and ')}; ${all.length} ${all.length === 1 ? 'is' : 'are'} written here`);
  }
  if (matching.length > 1) return { stories: matching };
  const route = readRoute(parsed.root, matching[0]!.path);
  const packages: Record<string, string> = {};
  for (const file of [route.file, ...route.files]) {
    const home = packageOf(parsed.root, file);
    if (home !== undefined) packages[file] = packageName(parsed.root, home);
  }
  return { route, packages, ...(parsed.zoom === undefined ? {} : { zoom: parsed.zoom }) };
}

/** The part of the route a zoom asks for, and the packages it opens. */
interface Part {
  readonly lines: readonly (Line | Gap)[];
  readonly open: ReadonlySet<string>;
  /** What `--in` asked for, to say so when the case goes through none of it. */
  readonly asked?: string;
  /** Which steps the part keeps, said above them, so a step outside what was asked is not read as a filter ignored. */
  readonly kept?: string;
}

function partOf(lines: readonly Line[], zoom: StoryZoom | undefined, packageOf: (file: string) => string | undefined, own: string | undefined): Part {
  const open = new Set(own === undefined ? [] : [own]);
  if (zoom === undefined || 'whole' in zoom) return { lines, open };
  if ('in' in zoom) {
    const chosen = inFile(zoom.in, packageOf);
    for (const line of lines) {
      if (!chosen(line)) continue;
      const files = 'loaded' in line.stop! ? line.stop.loaded : [line.stop!.place.file];
      for (const file of files) {
        const home = packageOf(file);
        if (home !== undefined && (home === zoom.in || file.includes(zoom.in))) open.add(home);
      }
    }
    const asked = `package or file matching \`${zoom.in}\``;
    return { lines: window(lines, chosen, 1), open, asked, kept: `the steps through the ${asked}, and the step either side of each run of them` };
  }
  const steps = lines.filter((line) => line.step !== undefined).length;
  if (zoom.around > steps) throw new OperatorError(`--around ${zoom.around} is past the end: this route has ${steps} steps`);
  return { lines: window(lines, (line) => line.step === zoom.around, AROUND), open, kept: `the ${AROUND} steps either side of step ${zoom.around}, and the loops they sit in` };
}

/** Steps shown either side of the one `--around` names. */
const AROUND = 3;

export function formatStory(answer: StoryAnswer, format: 'text' | 'json'): string {
  if ('stories' in answer) {
    if (format === 'json') {
      return `${JSON.stringify({ stories: answer.stories.map(({ file, name, visits }) => ({ file, name, visits })) }, null, 2)}\n`;
    }
    const lines = [`${answer.stories.length} stories; name one with --file and --name`, ''];
    for (const entry of answer.stories) lines.push(`  ${entry.file} > ${entry.name}  (${entry.visits} visits)`);
    return `${lines.join('\n')}\n`;
  }
  const { route } = answer;
  const packages = answer.packages ?? {};
  const packageOf = (file: string): string | undefined => packages[file];
  const own = packageOf(route.file);
  const lines = numbered(route);
  const steps = lines.filter((line) => line.step !== undefined).length;
  const part = partOf(lines, answer.zoom, packageOf, own);
  const drawn = drawings(part.lines, packageOf, part.open);
  const width = String(steps).length;
  const starts = armStarts(lines, route.untaken);
  const texts = drawn.map((drawing) => drawingText(drawing, route.before.length > 0, width, route.untaken, starts));
  const chosen = pick(texts.map(size), answer.zoom !== undefined && 'whole' in answer.zoom);
  const reading = drawn[chosen]!;
  const finer = chosen + 1 < drawn.length ? { level: drawn[chosen + 1]!.level, characters: size(texts[chosen + 1]!) } : undefined;
  if (format === 'json') {
    const { before: _before, route: _route, untaken: _untaken, ...head } = route;
    const shown = 'lines' in reading ? { ...reading, lines: reading.lines.map(lineJson) } : reading;
    const never = 'lines' in reading ? drawnUntaken(reading.lines, route.untaken) : [];
    return `${JSON.stringify({
      ...head, ...(own === undefined ? {} : { package: own }), steps, reading: shown, ...(never.length === 0 ? {} : { untaken: never }),
      ...(finer === undefined ? {} : { finer }),
    }, null, 2)}\n`;
  }
  const text = header(route, steps);
  if (steps === 0) text.push('', '  the case reached no instrumented code');
  else if (part.lines.length === 0) text.push('', `  the case goes through no ${part.asked ?? 'such step'}`);
  else {
    if (finer !== undefined) {
      text.push(
        `  drawn by ${reading.level}, because by ${finer.level} it would be ${finer.characters} characters, over the ${BUDGET} a reading is held to;`,
        '  narrow it with --in <package or file> or --around <step>, or read every step with --whole',
      );
    }
    if (part.kept !== undefined) text.push(`  ${part.kept}`);
    if (reading.level === 'steps') {
      text.push(`  passed through ${listed(reading.passed)}, a line for each run of steps; open one with --in <package>`);
    }
    if (reading.level === 'declarations') {
      text.push('  key  step   entering a declaration or coming back to it; 39×6 is step 39, which came round 6 times');
    }
    if ('lines' in reading) {
      text.push(
        '  key  step   one declaration, from entering or coming back to it until the case goes on to another',
        '       ×N     beside a declaration, times it was entered at that step; beside an arm or a loop, times it ran',
        '              there; under `steps a-b ran N times`, every pass of them is added',
        '       ✗      an arm the case never took, or a loop whose body never ran',
        '       ↑      an arm or a loop body entered at an earlier step, which this step runs inside',
        '       in 255 then:  inside the `then` arm of the `if` on line 255',
      );
    }
    text.push(...texts[chosen]!);
  }
  return `${text.join('\n')}\n`;
}

/** A drawing as the lines of text it reads as, blank line first. */
function drawingText(drawing: Drawing, sections: boolean, width: number, untaken: readonly Untaken[], starts: Starts): string[] {
  const text: string[] = [];
  switch (drawing.level) {
    case 'packages': packagesText(drawing.packages, text); break;
    case 'files': filesText(drawing.files, text); break;
    case 'declarations': overviewText(drawing.visits, text); break;
    default: linesText(drawing.lines, sections, width, untaken, starts, text);
  }
  return text;
}

/** How long a reading is, in characters. */
function size(text: readonly string[]): number {
  return text.reduce((sum, line) => sum + line.length + 1, 0);
}

function header(route: Route, steps: number): string[] {
  const files = route.files.length;
  const lines = [
    `story  ${route.file} > ${route.name}`,
    `  goes through ${files} ${files === 1 ? 'file' : 'files'} in ${steps} ${steps === 1 ? 'step' : 'steps'}`,
  ];
  if (route.stopped === true) lines.push('  the case threw or rejected, so the route ends where it stopped');
  if (route.untaped > 0) lines.push(`  the tape filled, and ${route.untaped} later visits are not on this route`);
  if (route.interleaved > 0) {
    lines.push(`  another case's work ran in the middle of this one ${times(route.interleaved)}, and is left out`);
  }
  if (route.unresolved.length > 0) {
    lines.push(
      `  ${route.unresolved.length} ${route.unresolved.length === 1 ? 'file is' : 'files are'} drawn as the file alone:`
        + ' the recording holds no regions for them at this text, and the next run of the suite records them',
    );
  }
  return lines;
}

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
  const never = new Map(untaken.map(({ place: at, arms }) => [`${at.file}\0${at.name}`, arms]));
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
    if (sections && line.before !== before) text.push(line.before ? '  before the case' : '  the case');
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
      return;
    }
    text.push(`  ${number}  ${indent}${placeText(stop.place, stop.entered, names)}`);
    const key = `${stop.place.file}\0${stop.place.name}`;
    const tree = armTree(stop.arms, never.get(key) ?? [], starts.get(key) ?? new Map());
    for (const branch of tree) text.push(`  ${blank}  ${indent}  ${branch}`);
  });
}

/** The line each arm of each declaration starts on, from every step on the route that took it and every arm it never took. */
type Starts = ReadonlyMap<string, ReadonlyMap<string, number>>;

function armStarts(lines: readonly Line[], untaken: readonly Untaken[]): Starts {
  const starts = new Map<string, Map<string, number>>();
  const add = (at: Place, arms: readonly { readonly path: string; readonly startLine?: number }[]) => {
    const key = `${at.file}\0${at.name}`;
    const known = starts.get(key) ?? starts.set(key, new Map()).get(key)!;
    for (const arm of arms) if (arm.startLine !== undefined) known.set(arm.path, arm.startLine);
  };
  for (const { stop } of lines) if (stop !== undefined && 'place' in stop) add(stop.place, stop.arms);
  for (const { place: at, arms } of untaken) add(at, arms);
  return starts;
}

function lineJson(line: Line | Gap | Through): unknown {
  if ('gap' in line || 'through' in line) return line;
  const { step, depth, before, stop, times, span } = line;
  return stop === undefined ? { repeats: times, steps: span, depth, before } : { step, depth, before, ...stop };
}

/** What the declarations a drawing draws never went into: the route carries it once, and so does the reading. */
function drawnUntaken(lines: readonly (Line | Gap | Through)[], untaken: readonly Untaken[]): Untaken[] {
  const drawn = new Set(lines.flatMap((line) =>
    'gap' in line || 'through' in line || line.stop === undefined || 'loaded' in line.stop ? [] : [`${line.stop.place.file}\0${line.stop.place.name}`]));
  return untaken.filter(({ place: at }) => drawn.has(`${at.file}\0${at.name}`));
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

function listed(names: readonly string[]): string {
  return names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

function loaded(files: readonly string[]): string {
  const named = files.slice(0, SHOWN).join(', ');
  const more = files.length > SHOWN ? `, and ${files.length - SHOWN} more` : '';
  return `loaded ${files.length} ${files.length === 1 ? 'file' : 'files'}: ${named}${more}`;
}

function times(count: number): string {
  return count === 1 ? 'once' : count === 2 ? 'twice' : `${count} times`;
}
