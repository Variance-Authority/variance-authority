/**
 * What the reader made of each changed file, as the lines a run prints.
 *
 * Two selectors print this: `variance run --since` and `variance select` in the
 * CLI. They share this function so the
 * wording has one implementation; a second copy of a printed finding drifts from
 * the first the day one of them learns a new verdict.
 *
 * A reading is a fact about the change, not about the tests, so it is printed
 * whichever way the selection went. A test in `unseen` gets a line of its own:
 * it loaded the file by an import the file graph does not list, so it is named
 * rather than selected, and the fix is the missing edge.
 */

import type { FileReading } from './reading.js';

export type { FileReading };

/**
 * One line per reading saying how its file was read, or why it was not, and
 * one line per test that loaded it through an import the graph does not list.
 * A selection gives every changed file a reading, so every one is named here;
 * the summary notes count each kind and say its remedy. Empty for no readings.
 *
 * What a verdict charges is said once, on the first line that prints that
 * verdict, and the lines after it print the verdict alone: a change to forty
 * files that all read `bodies` is one explanation and forty names, not forty
 * copies of the explanation.
 */
export function readingLines(readings: readonly FileReading[]): readonly string[] {
  const glossed = new Set<string>();
  const once = (key: keyof typeof GLOSS): string => {
    if (glossed.has(key)) return '';
    glossed.add(key);
    return GLOSS[key];
  };
  return [
    ...readings.flatMap((reading) => [
      `read ${reading.file}: ${verdictOf(reading)}${once(glossOf(reading))}`,
      ...(reading.verdict === undefined ? [] : (reading.unseen ?? [])).map(
        (test) => `unseen ${test}: loaded ${reading.file}${once('unseen')}`,
      ),
    ]),
  ];
}

function verdictOf(reading: FileReading): string {
  if (reading.verdict === undefined) return `unread (${UNREAD[reading.unread]})`;
  // No parser compared two texts here, so the parser's gloss would be a claim
  // nothing made; the reason is printed on every line, as `unread`'s is. The
  // reason names the record, not its tests: a run of one file lays a record
  // over its own text that still names every test carried from an earlier one.
  if (reading.kept === true) return `${reading.verdict} (the record was taken over this text)`;
  if (reading.verdict === 'values' && reading.names.length > 0) return `values (${reading.names.join(', ')})`;
  if (reading.verdict === 'load' && reading.effects !== undefined) {
    return `load (\`sideEffects\` declares ${reading.effects.join(', ')})`;
  }
  return reading.verdict;
}

/** The gloss a reading's line explains itself with, the first time that line is printed. */
function glossOf(reading: FileReading): keyof typeof GLOSS {
  if (reading.verdict === undefined) return UNREAD_GLOSS[reading.unread] ?? 'unread';
  return reading.kept === true ? 'kept' : reading.verdict;
}

const GLOSS = {
  none: ' — the runtime text is equal',
  // The landing that laid the record demoted every carried test that ran an
  // edited region of the earlier text (`layRecord`), so those tests are
  // selected as incomplete rather than skipped as having run this one.
  kept: ' — a test recorded over an earlier text of an edited region is not skipped',
  bodies: ' — the changed regions are charged, not the whole module',
  values: ' — the readers of the changed values and the changed regions are charged',
  load: ' — every test that loaded it is charged',
  unread: ' — its changed lines are charged',
  // A file with no row has no lines to charge: the walk charges what imports it.
  importers: ' — every test that loaded its nearest measured importers is charged',
  unseen: ' by an import the file graph does not list; named, not selected',
  keepsNone: ' — it keeps no test in the run',
  stale: ' — every region of it is charged',
  ignored: ' — only a test that declares it runs for it',
  // The reason says it all: the record answers for the file without its text.
  answered: '',
} as const;

/** The gloss an `unread` reason prints, when it is not `unread`'s own. */
const UNREAD_GLOSS: Partial<Record<keyof typeof UNREAD, keyof typeof GLOSS>> = {
  exports: 'importers',
  nothing: 'keepsNone',
  declined: 'keepsNone',
  stale: 'stale',
  ignored: 'ignored',
  answered: 'answered',
};

const UNREAD = {
  source: 'no recorded text to read it against',
  hunk: 'the diff does not apply to the recorded text',
  parse: 'one side does not parse',
  addon: 'no native scanner on this machine',
  language: 'not a JavaScript or TypeScript module',
  exports: 'it names no export to follow',
  nothing: 'the record and the file graph hold nothing about it',
  stale: 'recorded from a text nobody kept',
  declined: 'the suite declines relations and its record did not measure it',
  ignored: "the suite's `ignore` matches it",
  answered: 'its rows, its preconditions or its importers answer for it',
} as const;
