/**
 * The route one case took through the code, for one test: *where does this case
 * go, and in what order* — `covering` asks the other way round. It reads the
 * story a run writes under `VARIANCE_AUTHORITY_STORY=1` and prints a route
 * through declarations, drawn at the finest level that fits and narrowed a part at a time,
 * by the reading `@variance-authority/sense/story` holds. `--compare` sets readings
 * against each other (`story-compare.ts`), or, with no story taped, the
 * record's (`story-outcomes.ts`). Which runner writes the story is not its
 * business: any runner with the seam installed does.
 */

import {
  armStarts,
  BUDGET,
  drawingText,
  drawings,
  listStories,
  numbered,
  pick,
  readRoute,
  saidText,
  STORY_VARIABLE,
  through,
  unnotedText,
  untapedText,
  window,
  type Comparison,
  type Gap,
  type Line,
  type Route,
  type StoryEntry,
  type Through,
  type Untaken,
} from '@variance-authority/sense/story';
import { checkoutFile } from '../checkout-file.js';
import { OperatorError } from '../exit.js';
import { packageName, packageOf } from '../package-home.js';
import type { ParsedStory, StoryZoom } from '../story-args.js';
import { compareCases, compareStory, formatComparison, labelled, listed, type ComparedCase } from './story-compare.js';
import { formatOutcomes, recordedOutcomes, type RecordedOutcomes } from './story-outcomes.js';
import { caseOf, storiesText } from './story-list.js';

/** One route and how much of it to read, sides compared, or the stories to choose from when the flags name more than one case. */
export type StoryAnswer =
  | {
    readonly route: Route;
    readonly zoom?: StoryZoom;
    /** The package each file on the route and the test's own file is in, by its manifest; a file under none is absent. */
    readonly packages?: Readonly<Record<string, string>>;
    /** Which reading of the case this is, and how many are kept. */
    readonly reading?: {
      readonly of: number;
      readonly label?: string;
      readonly written?: number;
      /** Why `--compare` drew this reading alone: the side it names that holds none. */
      readonly unmatched?: string;
    };
  }
  | { readonly comparison: Comparison; readonly cases?: readonly ComparedCase[] }
  | RecordedOutcomes
  | { readonly stories: readonly StoryEntry[] };

/** The story the flags name, read as a route; every candidate when they name several. */
export function story(parsed: ParsedStory): StoryAnswer {
  const file = parsed.file === undefined ? undefined : checkoutFile(parsed.root, parsed.file);
  const zoom = parsed.zoom !== undefined && 'in' in parsed.zoom ? { in: checkoutFile(parsed.root, parsed.zoom.in) } : parsed.zoom;
  const all = listStories(parsed.root);
  const { compare } = parsed;
  const recorded = compare === 'outcome' ? recordedOutcomes(parsed.root, all, parsed.name, file) : undefined;
  if (recorded !== undefined) return recorded;
  if (all.length === 0) {
    throw new OperatorError(
      `no story in this checkout: run the test you are looking into with ${STORY_VARIABLE}=1, named by its file and the runner's own test-name filter, since every test the run runs writes one`,
    );
  }
  if (typeof compare === 'object' && 'cases' in compare) {
    return compareCases(parsed.root, all, compare.cases, { file, project: parsed.project, label: parsed.label });
  }
  const matching = all.filter(
    (entry) =>
      (file === undefined || entry.file === file)
      && (parsed.name === undefined || entry.name === parsed.name)
      && (parsed.project === undefined || entry.project === parsed.project)
      && (parsed.label === undefined || labelled(entry) === parsed.label),
  );
  if (matching.length === 0) {
    const asked = [
      parsed.file && `--file ${parsed.file}`, parsed.name && `--name ${parsed.name}`,
      parsed.project && `--project ${parsed.project}`, parsed.label && `--label ${parsed.label}`,
    ].filter(Boolean);
    throw new OperatorError(`no story is written for ${asked.join(' and ')}; ${all.length} ${all.length === 1 ? 'is' : 'are'} written here, and \`variance story\` alone lists them`);
  }
  // Readings are listed newest first within a case, so a case's first is its newest.
  const cases = new Set(matching.map(caseOf));
  if (cases.size > 1) return { stories: matching };
  const compared = compare === undefined ? undefined : compareStory(parsed.root, matching, compare);
  if (compared !== undefined && !('alone' in compared)) return { comparison: compared };
  const newest = compared?.alone ?? matching[0]!;
  const route = readRoute(parsed.root, newest.path);
  const packages: Record<string, string> = {};
  for (const file of [route.file, ...route.files]) {
    const home = packageOf(parsed.root, file);
    if (home !== undefined) packages[file] = packageName(parsed.root, home);
  }
  const reading = {
    of: matching.length,
    ...(newest.label === undefined ? {} : { label: newest.label }),
    ...(newest.written === undefined ? {} : { written: newest.written }),
    ...(compared === undefined ? {} : { unmatched: compared.unmatched }),
  };
  return { route, packages, reading, ...(zoom === undefined ? {} : { zoom }) };
}

/** The part of the route a zoom asks for, and the packages it opens. */
interface Part {
  readonly lines: readonly (Line | Gap)[];
  readonly open: ReadonlySet<string>;
  /** What `--in` or `--package` asked for, to say so when the case goes through none of it. */
  readonly asked?: string;
  /** Which steps the part keeps, said above them, so a step outside what was asked is not read as a filter ignored. */
  readonly kept?: string;
}

function partOf(lines: readonly Line[], zoom: StoryZoom | undefined, packageOf: (file: string) => string | undefined, own: string | undefined): Part {
  const open = new Set(own === undefined ? [] : [own]);
  if (zoom === undefined || 'whole' in zoom) return { lines, open };
  if ('in' in zoom || 'package' in zoom) {
    const inside = 'in' in zoom ? (file: string) => file === zoom.in : (file: string) => packageOf(file) === zoom.package;
    const chosen = through(inside);
    for (const line of lines) {
      if (!chosen(line)) continue;
      const files = 'loaded' in line.stop! ? line.stop.loaded : [line.stop!.place.file];
      for (const file of files) {
        const home = packageOf(file);
        if (home !== undefined && inside(file)) open.add(home);
      }
    }
    const asked = 'in' in zoom ? `the file \`${zoom.in}\`` : `the package \`${zoom.package}\``;
    return { lines: window(lines, chosen, 1), open, asked, kept: `the steps through ${asked}, and the step either side of each run of them` };
  }
  const steps = lines.filter((line) => line.step !== undefined).length;
  if (zoom.around > steps) throw new OperatorError(`--around ${zoom.around} is past the end: this route has ${steps} steps`);
  return { lines: window(lines, (line) => line.step === zoom.around, AROUND), open, kept: `the ${AROUND} steps either side of step ${zoom.around}, and the loops they sit in` };
}

/** Steps shown either side of the one `--around` names. */
const AROUND = 3;

export function formatStory(answer: StoryAnswer, format: 'text' | 'json'): string {
  if ('comparison' in answer) return formatComparison(answer.comparison, format, answer.cases);
  if ('outcomes' in answer) return formatOutcomes(answer.outcomes, format);
  if ('stories' in answer) return storiesText(answer.stories, format);
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
      ...head, ...(own === undefined ? {} : { package: own }),
      ...(answer.reading === undefined ? {} : { readings: answer.reading.of, label: answer.reading.label, written: answer.reading.written, unmatched: answer.reading.unmatched }),
      steps, reading: shown, ...(never.length === 0 ? {} : { untaken: never }),
      ...(finer === undefined ? {} : { finer }),
    }, null, 2)}\n`;
  }
  const text = header(route, steps, answer.reading);
  if (steps === 0) text.push('', '  the test ran no instrumented code');
  else if (part.lines.length === 0) text.push('', `  the test does not go through ${part.asked ?? 'such a step'}`);
  else {
    if (finer !== undefined) {
      text.push(
        `  drawn by ${reading.level}: by ${finer.level} it would be ${finer.characters} characters, and a story is kept under ${BUDGET};`,
        '  narrow it with --in <file>, --package <name> or --around <step>, or read every step with --whole',
      );
    }
    if (part.kept !== undefined) text.push(`  ${part.kept}`);
    if (reading.level === 'steps') {
      text.push(`  passed through ${listed(reading.passed)}, one line for each series of steps in a row there; open one with --package <name>`);
    }
    if (reading.level === 'declarations') {
      text.push('  key  step   the test going into a function or coming back to it; 39×6 is step 39, repeated 6 times');
    }
    if ('lines' in reading) {
      text.push(
        '  key  step   one function, method or callback, from the test going in or coming back until it goes to another',
        '       ×N     beside a function, how many times the test called it at this step; beside a branch or a loop, how',
        '              many times it ran there; under `steps a-b ran N times`, every pass of them is added',
        '       ✗      a branch the test never took, or a loop whose body never ran',
        '       ↑      a branch or a loop body the test went into at an earlier step; this step runs inside it',
        '       in 255 then:  inside the `then` branch of the `if` on line 255',
      );
    }
    text.push(...texts[chosen]!);
  }
  return `${text.join('\n')}\n`;
}

/** How long a reading is, in characters. */
function size(text: readonly string[]): number {
  return text.reduce((sum, line) => sum + line.length + 1, 0);
}


function header(route: Route, steps: number, reading: Extract<StoryAnswer, { route: Route }>['reading']): string[] {
  const files = route.files.length;
  const lines = [
    `story  ${route.file} > ${route.name}`,
    ...(route.project === undefined ? [] : [`  under the project ${route.project}`]),
    `  goes through ${files} ${files === 1 ? 'file' : 'files'} in ${steps} ${steps === 1 ? 'step' : 'steps'}`,
  ];
  if (reading !== undefined && reading.of > 1) {
    const label = reading.label === undefined ? '' : `, labelled ${reading.label}`;
    const written = reading.written === undefined ? '' : `, written ${new Date(reading.written).toISOString()}`;
    lines.push(`  the newest of ${reading.of} readings${label}${written}${reading.unmatched === undefined ? '; set them against each other with --compare' : ''}`);
  }
  if (reading?.unmatched !== undefined) lines.push(`  ${reading.unmatched}`);
  if (route.stopped === true) lines.push('  the test threw or rejected, so the route ends where it stopped');
  if (route.lost === true) lines.push('  a page the test ran in was gone before what it ran there was read, so the route is missing that');
  lines.push(...untapedText(route).map((line) => `  ${line}`));
  if (route.interleaved > 0) {
    lines.push(`  another test's work ran in the middle of this one ${times(route.interleaved)}, and is left out`);
  }
  if (route.documents !== undefined) {
    lines.push(
      `  ran in ${route.documents} page documents, each said where the route moves into it; a ref is its own document's,`
        + ' and what two of them did within one test line is in the order it reached the runner, not the order it ran',
    );
  }
  lines.push(...unnotedText(route).map((line) => `  ${line}`));
  for (const [part, said] of [['before the test', route.opening?.before], ['the test', route.opening?.route]] as const) {
    if (said === undefined) continue;
    lines.push(`  said as ${part} began, before its first step:`, ...saidText(said, '    '));
  }
  if (route.unresolved.length > 0) {
    lines.push(
      `  ${route.unresolved.length} ${route.unresolved.length === 1 ? 'file is' : 'files are'} drawn as the file alone:`
        + ` the recording holds no regions for ${route.unresolved.length === 1 ? 'it' : 'them'} at this text`,
    );
  }
  return lines;
}

function lineJson(line: Line | Gap | Through): unknown {
  if ('gap' in line || 'through' in line) return line;
  const { step, depth, before, stop, times, span } = line;
  return stop === undefined ? { repeats: times, steps: span, depth, before } : { step, depth, before, ...stop };
}

/** What the declarations a drawing draws never went into: the route carries it once, and so does the reading. */
function drawnUntaken(lines: readonly (Line | Gap | Through)[], untaken: readonly Untaken[]): Untaken[] {
  const drawn = new Set(lines.flatMap((line) =>
    'gap' in line || 'through' in line || line.stop === undefined || 'loaded' in line.stop ? [] : [line.stop.place.at]));
  return untaken.filter(({ place: at }) => drawn.has(at.at));
}

function times(count: number): string {
  return count === 1 ? 'once' : count === 2 ? 'twice' : `${count} times`;
}
