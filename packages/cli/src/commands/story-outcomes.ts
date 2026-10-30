/**
 * A flaky case compared from the record every run writes, with no story taped:
 * `--compare outcome` falls back here, and `compareOutcomes` says what it tells.
 */

import { compareOutcomes, recordedReadings, type Charge, type OutcomeComparison, type OutcomeRegion, type StoryEntry } from '@variance-authority/sense/story';
import { OperatorError } from '../exit.js';
import { armWords, lines, LISTED, listed } from './story-compare.js';

/** The answer when the record's readings are compared. */
export interface RecordedOutcomes {
  readonly outcomes: OutcomeComparison;
}

/**
 * The case `name` names, compared by outcome from the readings the record
 * keeps of it; nothing when a story of it is taped among `stories`, or no
 * record keeps an earlier reading of it, so the story's own answer is given.
 */
export function recordedOutcomes(root: string, stories: readonly StoryEntry[], name: string | undefined, file: string | undefined): RecordedOutcomes | undefined {
  if (name === undefined || stories.some((entry) => (file === undefined || entry.file === file) && entry.name === name)) return undefined;
  const found = recordedReadings(root, name, file);
  if (found.length === 0) return undefined;
  const files = [...new Set(found.map((one) => one.file))];
  if (files.length > 1) {
    throw new OperatorError(`--name ${name} is a case in ${listed(files)}; name the file with --file`);
  }
  const [recorded] = found;
  const outcomes = compareOutcomes(recorded!);
  if (outcomes !== undefined) return { outcomes };
  const runs = recorded!.readings.reduce((sum, reading) => sum + reading.count, 0);
  const had = recorded!.readings[0]!.stopped === true ? 'threw' : 'passed';
  throw new OperatorError(
    `every one of the ${runs} runs the record keeps of ${recorded!.file} > ${recorded!.name} ${had}, so there is no other outcome to compare it with; run it until it has passed and thrown, twice each`,
  );
}

/**
 * A comparison of the record's readings as text: each region every run of one
 * outcome treated one way and every run of the other another, then the count
 * of what moved within an outcome as well.
 */
export function formatOutcomes(comparison: OutcomeComparison, format: 'text' | 'json'): string {
  if (format === 'json') return `${JSON.stringify({ outcomes: comparison }, null, 2)}\n`;
  const runs = (count: number): string => `${count} ${count === 1 ? 'run' : 'runs'}`;
  const text = [
    `compare  ${comparison.file} > ${comparison.name}, from the readings the record keeps`,
    `  passed (${runs(comparison.passed)}) against threw (${runs(comparison.threw)})`,
  ];
  if (comparison.single) {
    text.push('  one run on a side: what differs below may be a run that went another way, not the outcome');
  }
  const rows: [string, string[]][] = [
    ['charged to an earlier line when it threw', []],
    ['charged to a later line when it threw', []],
    ['charged to no line, its drain too late, only when it threw', []],
    ['charged to no line, its drain too late, only when it passed', []],
    ['charged to a hook only when it threw', []],
    ['charged to a hook only when it passed', []],
    ['reached only when it passed', comparison.onlyPassed.map(regionText)],
    ['reached only when it threw', comparison.onlyThrew.map(regionText)],
  ];
  for (const { region, passed, threw } of comparison.moved) {
    const row = threw.line === undefined ? 2
      : passed.line === undefined ? 3
      : threw.line < passed.line ? 0
      : threw.line > passed.line ? 1
      : threw.hook ? 4 : 5;
    rows[row]![1].push(`${regionText(region)}  ${chargeText(passed)} when it passed, ${chargeText(threw)} when it threw`);
  }
  for (const [heading, listed] of rows) {
    if (listed.length === 0) continue;
    text.push('', `  ${heading}, on every run:`);
    for (const line of listed.slice(0, LISTED)) text.push(`    ${line}`);
    if (listed.length > LISTED) text.push(`    and ${listed.length - LISTED} more regions`);
  }
  if (rows.every(([, listed]) => listed.length === 0)) {
    text.push('', '  nothing separates the outcomes: whatever differs between them differs between runs of one outcome too');
  }
  if (comparison.unsteady > 0) {
    text.push('', `  left out, because they differ between runs of one outcome as well: ${comparison.unsteady} ${comparison.unsteady === 1 ? 'region' : 'regions'}`);
  }
  return `${text.join('\n')}\n`;
}

function regionText({ file, name, path, startLine, endLine }: OutcomeRegion): string {
  const where = `${name === '' ? '(top level)' : name}  ${file}:${lines(startLine, endLine)}`;
  return path === 'entry' || path === 'module' ? where : `${where}, ${armWords(path)}`;
}

function chargeText({ line, hook }: Charge): string {
  if (line === undefined) return 'no line';
  const at = line === 0 ? 'before the first line' : `line ${line}`;
  return hook ? `${at}, in a hook` : at;
}

