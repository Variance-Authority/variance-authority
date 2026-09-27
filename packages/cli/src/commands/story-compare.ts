/**
 * Readings of one case, set against each other.
 *
 * A route answers *where did this case go*. When the case goes somewhere else
 * on another run — it failed once in ten, it behaves differently with a flag
 * on — the question is *what differs*, and two routes read side by side answer
 * it badly: async work finishes in another order on every run, so two readings
 * of a case that passed both times already differ, and the reader cannot tell
 * which difference decided the outcome. `compareReadings` keeps only what holds
 * on every reading of one side and on none of the other, and counts the rest.
 * This file picks the sides from the flags and prints what separates them.
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

/** The two sides `compare` names among one case's readings, newest first, compared. */
export function compareStory(root: string, readings: readonly StoryEntry[], compare: StoryCompare): Comparison {
  if (compare === 'last') {
    if (readings.length < 2) throw new OperatorError(`--compare last needs two readings of this case, and ${readings.length} is kept; run it again`);
    return compareReadings(root, { name: 'newest', readings: [readings[0]!] }, { name: 'the one before', readings: [readings[1]!] });
  }
  if (compare === 'outcome') {
    const passed = readings.filter((entry) => entry.stopped === false);
    const threw = readings.filter((entry) => entry.stopped === true);
    if (passed.length === 0 || threw.length === 0) {
      throw new OperatorError(
        `--compare outcome needs readings that passed and readings that threw, and of ${readings.length} kept ${passed.length} passed and ${threw.length} threw;`
          + ' run the case until it has done both',
      );
    }
    return compareReadings(root, { name: 'passed', readings: passed }, { name: 'threw', readings: threw });
  }
  const sides = compare.labels.map((label) => ({ name: label, readings: readings.filter((entry) => labelled(entry) === label) }));
  const empty = sides.filter((side) => side.readings.length === 0).map((side) => side.name);
  if (empty.length > 0) {
    const kept = [...new Set(readings.map(labelled))].sort();
    throw new OperatorError(`no reading of this case is labelled ${empty.join(' or ')}; the labels kept are ${kept.join(', ')}`);
  }
  return compareReadings(root, sides[0]!, sides[1]!);
}

/** Pairs in the opposite order listed before the rest are counted. */
const PAIRS = 5;

/** Differences of one kind listed on a side before the rest are counted. */
const LISTED = 12;

export function formatComparison(comparison: Comparison, format: 'text' | 'json'): string {
  if (format === 'json') return `${JSON.stringify({ comparison }, null, 2)}\n`;
  const [a, b] = comparison.sides;
  const text = [
    `compare  ${comparison.file} > ${comparison.name}`,
    `  ${sideText(a)} against ${sideText(b)}`,
  ];
  if (comparison.single) {
    text.push(
      '  one reading on a side: what differs below may be a run that went another way, not the side;',
      '  run the case again under each label, or until it has passed and thrown more than once',
    );
  }
  let found = false;
  comparison.places.forEach((only, at) => {
    const said = comparison.said[at]!;
    if (only.items.length + said.items.length === 0) return;
    found = true;
    text.push('', `  only ${sideWhen(only.side)}, on every reading:`);
    for (const item of only.items.slice(0, LISTED)) text.push(`    went into  ${placeText(item)}`);
    if (only.items.length > LISTED) text.push(`    and ${only.items.length - LISTED} more places`);
    for (const line of said.items.slice(0, LISTED)) text.push(`    said       » ${line}`);
    if (said.items.length > LISTED) text.push(`    and ${said.items.length - LISTED} more lines`);
  });
  if (comparison.reversed.length > 0) {
    found = true;
    text.push('', `  in the opposite order ${sideWhen(a.name)} and ${sideWhen(b.name)}, on every reading:`);
    for (const [first, then] of comparison.reversed.slice(0, PAIRS)) {
      text.push(`    ${momentText(first)}`, `      before ${momentText(then)} ${sideWhen(a.name)}, after it ${sideWhen(b.name)}`);
    }
    const rest = comparison.reversed.length - PAIRS;
    if (rest > 0) text.push(`    and ${rest} more ${rest === 1 ? 'pair' : 'pairs'}; the first is where the orders part`);
  }
  if (!found) text.push('', '  nothing separates the sides: whatever differs between them differs between readings of one side too');
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

function sideText(side: Comparison['sides'][number]): string {
  const readings = `${side.readings} ${side.readings === 1 ? 'reading' : 'readings'}`;
  const threw = side.stopped === 0 ? '' : side.stopped === side.readings ? ', every one threw' : `, ${side.stopped} threw`;
  return `${side.name} (${readings}${threw})`;
}

/** A side as the condition it stands for: `when it threw`, `under slow`. */
function sideWhen(name: string): string {
  if (name === 'passed' || name === 'threw') return `when it ${name}`;
  if (name === 'newest' || name === 'the one before') return `in ${name}`;
  return `under ${name}`;
}

function placeText({ place, path, startLine, endLine }: PlaceDifference): string {
  const where = declarationText(place);
  if (path === 'entry' || path === 'module') return where;
  return `${where}, ${armWords(path)}${startLine === undefined ? '' : ` on ${lines(startLine, endLine)}`}`;
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
