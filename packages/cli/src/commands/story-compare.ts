/**
 * Readings set against each other: of one case, or of several cases.
 *
 * A route answers *where did this case go*. When the case goes somewhere else
 * on another run — it failed once in ten, it behaves differently with a flag
 * on — or a case next to it goes somewhere else — the same test with the user
 * Mike, with the flag off — the question is *what differs*, and routes read side
 * by side answer it badly: async work finishes in another order on every run,
 * so two readings of a case that passed both times already differ, and the
 * reader cannot tell which difference decided the outcome. `compareReadings`
 * keeps only what holds on every reading of some sides and on none of the
 * others, and counts the rest. This file picks the sides from the flags and
 * prints what separates them.
 */

import {
  compareReadings,
  type Comparison,
  type Moment,
  type PlaceDifference,
  type StoryEntry,
} from '@variance-authority/sense/story';
import { OperatorError } from '../exit.js';
import type { StoryCompare } from '../story-args.js';

/** What a run with the variable set to `1` is called, when a comparison names it. */
const UNLABELLED = '1';

/** The label a reading was written under, as `--label` and `--compare` spell it. */
export function labelled(entry: StoryEntry): string {
  return entry.label ?? UNLABELLED;
}

/**
 * A reading drawn on its own, because one side `--compare` names holds none,
 * and the sentence that says which side is missing.
 */
export interface Unmatched {
  readonly alone: StoryEntry;
  readonly unmatched: string;
}

/** A case a comparison of cases sets against the others, by its file and its whole name; absent when the sides are readings of one case. */
export interface ComparedCase {
  readonly file: string;
  readonly name: string;
}

/**
 * The sides `compare` names among one case's readings, newest first,
 * compared. When a side holds no reading, the newest of another is drawn
 * alone, with what is missing said beside it.
 */
export function compareStory(root: string, readings: readonly StoryEntry[], compare: Exclude<StoryCompare, { cases: unknown }>): Comparison | Unmatched {
  const alone = (side: readonly StoryEntry[], missing: string): Unmatched => ({ alone: (side[0] ?? readings[0])!, unmatched: `nothing to compare it with: ${missing}` });
  if (compare === 'last') {
    if (readings.length < 2) return alone(readings, 'this is the only reading of this case kept');
    return compareReadings(root, [{ name: 'newest', readings: [readings[0]!] }, { name: 'the one before', readings: [readings[1]!] }]);
  }
  if (compare === 'outcome') {
    const passed = readings.filter((entry) => entry.stopped === false);
    const threw = readings.filter((entry) => entry.stopped === true);
    if (passed.length === 0 || threw.length === 0) {
      const [had, none] = passed.length === 0 ? ['threw', 'passed'] : ['passed', 'threw'];
      const every = readings.length === 1 ? 'the one reading kept' : `every one of the ${readings.length} readings kept`;
      return alone(passed.length === 0 ? threw : passed, `${every} ${had}, and none ${none}`);
    }
    return compareReadings(root, [{ name: 'passed', readings: passed }, { name: 'threw', readings: threw }]);
  }
  const sides = compare.labels.map((label) => ({ name: label, readings: readings.filter((entry) => labelled(entry) === label) }));
  const empty = sides.filter((side) => side.readings.length === 0).map((side) => side.name);
  if (empty.length > 0) {
    const kept = [...new Set(readings.map(labelled))].sort();
    const held = sides.find((side) => side.readings.length > 0)?.readings ?? [];
    return alone(held, `no reading of this case is labelled ${empty.join(' or ')}; the labels kept are ${kept.join(', ')}`);
  }
  return compareReadings(root, sides);
}

/**
 * Several cases, each side every reading kept of one, in `file` and under
 * `label` when they are given. A name is a case's whole name, or its file and name as
 * `<file> > <name>`; a name two files hold is refused rather than picked, and so
 * is a name with no reading. A side is named by its case, and by its file too
 * when the cases are in more than one.
 */
export function compareCases(
  root: string,
  stories: readonly StoryEntry[],
  names: readonly string[],
  { file, label }: { readonly file: string | undefined; readonly label: string | undefined },
): { readonly comparison: Comparison; readonly cases: readonly ComparedCase[] } {
  const held = stories.filter((entry) => (file === undefined || entry.file === file) && (label === undefined || labelled(entry) === label));
  const found = names.map((asked) => held.filter((entry) => entry.name === asked || `${entry.file} > ${entry.name}` === asked));
  const missing = names.filter((_, at) => found[at]!.length === 0);
  if (missing.length > 0) {
    const asked = [
      missing.map((name) => `--name ${name}`).join(' or '),
      ...(file === undefined ? [] : [`--file ${file}`]),
      ...(label === undefined ? [] : [`--label ${label}`]),
    ];
    throw new OperatorError(`no story is written for ${asked.join(' and ')}; \`variance story\` alone lists the ones written here`);
  }
  const cases = found.map((readings, at) => {
    const files = [...new Set(readings.map((entry) => entry.file))];
    if (files.length > 1) {
      throw new OperatorError(`--name ${names[at]} is a case in ${listed(files)}; name the file with --file, or compare them as \`<file> > <name>\``);
    }
    return { file: files[0]!, name: readings[0]!.name, readings };
  });
  const same = cases.findIndex((one, at) => cases.findIndex((other) => other.file === one.file && other.name === one.name) !== at);
  if (same !== -1) {
    const first = cases.findIndex((other) => other.file === cases[same]!.file && other.name === cases[same]!.name);
    throw new OperatorError(`--name ${names[first]} and --name ${names[same]} are one case; name each case once`);
  }
  const oneFile = new Set(cases.map((one) => one.file)).size === 1;
  const sides = cases.map((one) => ({ name: oneFile ? one.name : `${one.file} > ${one.name}`, readings: one.readings }));
  return { comparison: compareReadings(root, sides), cases: cases.map(({ file, name }) => ({ file, name })) };
}

/** Pairs in a differing order listed before the rest are counted. */
const PAIRS = 5;

/** Differences of one kind listed for a group of sides before the rest are counted. */
const LISTED = 12;

/**
 * A comparison as text: what holds on every reading of some sides and none of
 * the others, grouped by the sides that hold it. `cases` says the sides are
 * cases rather than readings of one, which changes how a side is named.
 */
export function formatComparison(comparison: Comparison, format: 'text' | 'json', cases?: readonly ComparedCase[]): string {
  if (format === 'json') return `${JSON.stringify({ comparison, ...(cases === undefined ? {} : { cases }) }, null, 2)}\n`;
  const phrase = (names: readonly string[]): string => (cases === undefined ? readingsPhrase(names) : `in ${listed(names.map((name) => `\`${name}\``))}`);
  const sides = comparison.sides.map((side) => sideText(side, cases !== undefined));
  const files = new Set(cases?.map((one) => one.file));
  const text = [
    `compare  ${cases === undefined ? `${comparison.file} > ${comparison.name}` : files.size === 1 ? [...files][0] : `cases in ${files.size} files`}`,
    sides.length === 2 ? `  ${sides[0]} against ${sides[1]}` : `  ${listed(sides)}, against each other`,
  ];
  if (comparison.single) {
    text.push(
      '  one reading on a side: what differs below may be a run that went another way, not the side',
    );
  }
  for (const only of comparison.only) {
    text.push('', `  only ${phrase(only.sides)}, on every reading:`);
    for (const item of only.places.slice(0, LISTED)) text.push(`    went into  ${placeText(item)}`);
    if (only.places.length > LISTED) text.push(`    and ${only.places.length - LISTED} more places`);
    for (const line of only.said.slice(0, LISTED)) text.push(`    said       » ${line}`);
    if (only.said.length > LISTED) text.push(`    and ${only.said.length - LISTED} more lines`);
  }
  if (comparison.orders.length > 0) {
    const [a, b] = comparison.sides;
    text.push('', comparison.sides.length === 2
      ? `  in the opposite order ${phrase([a!.name])} and ${phrase([b!.name])}, on every reading:`
      : '  in an order the sides hold differently, on every reading:');
    for (const { pair: [first, then], before, after } of comparison.orders.slice(0, PAIRS)) {
      text.push(`    ${momentText(first)}`, `      before ${momentText(then)} ${phrase(before)}, after it ${phrase(after)}`);
    }
    const rest = comparison.orders.length - PAIRS;
    if (rest > 0) text.push(`    and ${rest} more ${rest === 1 ? 'pair' : 'pairs'}; the first is where the orders part`);
  }
  if (comparison.only.length + comparison.orders.length === 0) {
    text.push('', '  nothing separates the sides: whatever differs between them differs between readings of one side too');
  }
  const { places, said, order } = comparison.unsteady;
  if (places + said + order > 0) {
    const counted = [
      places > 0 ? `${places} ${places === 1 ? 'place' : 'places'}` : '',
      said > 0 ? `${said} ${said === 1 ? 'line' : 'lines'} said` : '',
      order > 0 ? `${order} ${order === 1 ? 'pair' : 'pairs'} in changing order` : '',
    ].filter(Boolean);
    text.push('', `  left out, because they differ between readings of one side as well: ${counted.join(', ')}`);
  }
  return `${text.join('\n')}\n`;
}

function sideText(side: Comparison['sides'][number], quoted: boolean): string {
  const readings = `${side.readings} ${side.readings === 1 ? 'reading' : 'readings'}`;
  const threw = side.stopped === 0 ? '' : side.stopped === side.readings ? ', every one threw' : `, ${side.stopped} threw`;
  return `${quoted ? `\`${side.name}\`` : side.name} (${readings}${threw})`;
}

/** Sides of one case as the condition they stand for: `when it threw`, `under slow and fast`. */
function readingsPhrase(names: readonly string[]): string {
  if (names.length === 1 && (names[0] === 'passed' || names[0] === 'threw')) return `when it ${names[0]}`;
  if (names.length === 1 && (names[0] === 'newest' || names[0] === 'the one before')) return `in ${names[0]}`;
  return `under ${listed(names)}`;
}

/** Every name in prose, however many: a side left out of a list is a side the reader cannot find. */
export function listed(names: readonly string[]): string {
  return names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

function placeText({ place, path, startLine, endLine, constructLine }: PlaceDifference): string {
  const where = declarationText(place);
  if (path === 'entry' || path === 'module') return where;
  // An arm of an `if` is placed by the line the `if` is named by, as the route draws it.
  const on = constructLine !== undefined ? `${constructLine}` : startLine === undefined ? undefined : lines(startLine, endLine);
  return `${where}, ${armWords(path)}${on === undefined ? '' : ` on ${on}`}`;
}

function momentText(moment: Moment): string {
  if ('said' in moment) return `» ${moment.said}`;
  if ('loaded' in moment) return `loading ${moment.loaded}`;
  return declarationText(moment.place);
}

function declarationText(place: PlaceDifference['place']): string {
  const name = place.name === '' ? '(top level)' : place.name;
  return `${name}  ${place.file}${place.startLine === undefined ? '' : `:${lines(place.startLine, place.endLine)}`}`;
}

function lines(start: number, end: number | undefined): string {
  return end === undefined || end === start ? `${start}` : `${start}-${end}`;
}

/** A region's path as the arm it names: `for#0/body/if#1/else` is the `else` of an `if`. */
function armWords(path: string): string {
  const parts = path.split('/');
  const arm = parts.at(-1)!;
  const construct = parts.at(-2)?.replace(/#\d+$/u, '');
  if (construct === undefined) return arm.replace(/#\d+$/u, '');
  if (arm === 'after') return `past the ${construct}`;
  return `the ${arm} of the ${construct}`;
}
