/**
 * The route one case took through the code.
 *
 * `covering` answers *which tests went here*; this answers the question from
 * the other end, for one test: *where does this case go, and in what order*.
 * It reads a story, which a run writes under `VARIANCE_AUTHORITY_STORY=1`, and
 * prints it as a route through declarations — the functions, handlers and top
 * levels the case passed through, a loop drawn once, modules loaded along the
 * way named as one stop. It is a map to read before opening files, not a
 * trace to step through: which arm of an `if` ran, and how many times a loop
 * went round, stay on the tape.
 *
 * A long route is read a part at a time: an overview first, then the steps
 * through one file or around one step — `story-view.ts` says why a step
 * number, and not a caller, is what joins the parts.
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
} from '@variance-authority/sense/story';
import { OperatorError } from '../exit.js';
import type { ParsedStory, StoryZoom } from '../story-args.js';
import { inFile, numbered, overview, window, type FileVisits, type Gap, type Line } from './story-view.js';

/** One route and how much of it to read, or the stories to choose from when the flags name more than one. */
export type StoryAnswer =
  | { readonly route: Route; readonly zoom?: StoryZoom }
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
  return parsed.zoom === undefined ? { route } : { route, zoom: parsed.zoom };
}

/** What a reading shows: the overview, or the numbered lines of a part of the route. */
type Reading = { readonly files: readonly FileVisits[] } | { readonly lines: readonly (Line | Gap)[]; readonly asked?: string };

function reading(lines: readonly Line[], zoom: StoryZoom | undefined): Reading {
  if (zoom === undefined) return { files: overview(lines) };
  if ('whole' in zoom) return { lines };
  if ('in' in zoom) return { lines: window(lines, inFile(zoom.in), 1), asked: `file matching \`${zoom.in}\`` };
  const steps = lines.filter((line) => line.step !== undefined).length;
  if (zoom.around > steps) throw new OperatorError(`--around ${zoom.around} is past the end: this route has ${steps} steps`);
  return { lines: window(lines, (line) => line.step === zoom.around, AROUND) };
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
  const lines = numbered(route);
  const steps = lines.filter((line) => line.step !== undefined).length;
  const read = reading(lines, answer.zoom);
  if (format === 'json') {
    const { before: _before, route: _route, ...head } = route;
    const body = 'files' in read ? { visits: read.files } : { lines: read.lines.map(lineJson) };
    return `${JSON.stringify({ ...head, steps, ...body }, null, 2)}\n`;
  }
  const text = header(route, steps);
  if (steps === 0) text.push('', '  the case reached no instrumented code');
  else if ('files' in read) overviewText(read.files, text);
  else if (read.lines.length === 0) text.push('', `  the case goes through no ${read.asked ?? 'such step'}`);
  else linesText(read.lines, route.before.length > 0, String(steps).length, text);
  return `${text.join('\n')}\n`;
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
        + ' the recording holds no regions for them at this text, and `yarn test` records them',
    );
  }
  return lines;
}

function overviewText(files: readonly FileVisits[], text: string[]): void {
  for (const file of files) {
    text.push('', `  ${file.file}${file.loadedAt === undefined ? '' : `  loaded at step ${file.loadedAt}`}`);
    for (const visit of file.declarations) {
      const where = lineRange(visit);
      const name = where === '' ? '(the file alone)' : `${where}  ${declaration(visit)}`;
      text.push(`    ${name}  ${stepList(visit.steps)}${visit.looped ? ', in a loop' : ''}`);
    }
  }
  text.push(
    '',
    '  read the steps through one file with --in <file>, the steps near one with --around <step>,',
    '  or the whole route with --whole',
  );
}

function linesText(lines: readonly (Line | Gap)[], sections: boolean, width: number, text: string[]): void {
  text.push('');
  let before: boolean | undefined;
  const blank = ' '.repeat(width);
  lines.forEach((line, at) => {
    if ('gap' in line) {
      // At the depth of what follows, so a gap inside a loop reads as inside it.
      const next = lines[at + 1];
      const indent = '  '.repeat(next === undefined || 'gap' in next ? 0 : next.depth);
      const [from, to] = line.gap;
      text.push(`  ${blank}  ${indent}… ${from === to ? `step ${from}` : `steps ${from}-${to}`}`);
      return;
    }
    if (sections && line.before !== before) text.push(line.before ? '  before the case' : '  the case');
    before = line.before;
    const indent = '  '.repeat(line.depth);
    const number = line.step === undefined ? blank : String(line.step).padStart(width);
    const stop = line.stop;
    const body = stop === undefined ? 'repeats' : 'loaded' in stop ? loaded(stop.loaded) : place(stop.place);
    text.push(`  ${number}  ${indent}${body}`);
  });
}

function lineJson(line: Line | Gap): unknown {
  if ('gap' in line) return line;
  const { step, depth, before, stop } = line;
  return stop === undefined ? { repeats: true, depth, before } : { step, depth, before, ...stop };
}

function place(place: Place): string {
  const where = lineRange(place);
  return where === '' ? place.file : `${place.file}:${where}  ${declaration(place)}`;
}

function lineRange({ startLine, endLine }: { readonly startLine?: number; readonly endLine?: number }): string {
  if (startLine === undefined) return '';
  return startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`;
}

function declaration({ name, kind }: { readonly name: string; readonly kind: Place['kind'] }): string {
  const named = name === '' ? '(top level)' : name;
  return kind === 'function' || kind === 'module' ? named : `${named}  ${kind}`;
}

/** Step numbers shown for one declaration before the rest are counted. */
const LISTED = 6;

function stepList(steps: readonly number[]): string {
  if (steps.length === 1) return `step ${steps[0]}`;
  const listed = steps.slice(0, LISTED).join(', ');
  return `steps ${listed}${steps.length > LISTED ? `, and ${steps.length - LISTED} more` : ''}`;
}

const SHOWN = 3;

function loaded(files: readonly string[]): string {
  const named = files.slice(0, SHOWN).join(', ');
  const more = files.length > SHOWN ? `, and ${files.length - SHOWN} more` : '';
  return `loaded ${files.length} ${files.length === 1 ? 'file' : 'files'}: ${named}${more}`;
}

function times(count: number): string {
  return count === 1 ? 'once' : count === 2 ? 'twice' : `${count} times`;
}
