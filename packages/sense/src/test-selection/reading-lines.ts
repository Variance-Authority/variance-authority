/**
 * What the parser made of each changed file, as the lines a run prints.
 *
 * Two selectors print this: `variance run --since` and `variance select` in the
 * CLI, and `yarn test:since` in this repository. They share this function so the
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
 * One line per changed file saying how it was read, or why it was not, and one
 * line per test that loaded it through an import the graph does not list.
 * Empty for no readings.
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
  return readings.flatMap((reading) => [
    `read ${reading.file}: ${verdictOf(reading)}${once(reading.verdict ?? 'unread')}`,
    ...(reading.verdict === undefined ? [] : (reading.unseen ?? [])).map(
      (test) => `unseen ${test}: loaded ${reading.file}${once('unseen')}`,
    ),
  ]);
}

function verdictOf(reading: FileReading): string {
  if (reading.verdict === undefined) return `unread (${UNREAD[reading.unread]})`;
  if (reading.verdict === 'values' && reading.names.length > 0) return `values (${reading.names.join(', ')})`;
  if (reading.verdict === 'load' && reading.effects !== undefined) {
    return `load (\`sideEffects\` declares ${reading.effects.join(', ')})`;
  }
  return reading.verdict;
}

const GLOSS = {
  none: ' — the runtime text is equal',
  bodies: ' — the changed regions are charged, not the whole module',
  values: ' — the readers of the changed values and the changed regions are charged',
  load: ' — every test that loaded it is charged',
  unread: ' — its changed lines are charged',
  unseen: ' by an import the file graph does not list; named, not selected',
} as const;

const UNREAD = {
  source: 'no recorded text to read it against',
  hunk: 'the diff does not apply to the recorded text',
  parse: 'one side does not parse',
  addon: 'no native scanner on this machine',
  language: 'not a JavaScript or TypeScript module',
} as const;
