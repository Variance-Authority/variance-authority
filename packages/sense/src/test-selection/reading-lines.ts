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
 */
export function readingLines(readings: readonly FileReading[]): readonly string[] {
  return readings.flatMap((reading) => [
    `read ${reading.file}: ${verdictOf(reading)}`,
    ...(reading.verdict === undefined ? [] : (reading.unseen ?? [])).map(
      (test) => `unseen ${test}: loaded ${reading.file} through an import the file graph does not list; named, not selected`,
    ),
  ]);
}

function verdictOf(reading: FileReading): string {
  if (reading.verdict === undefined) return `unread — ${UNREAD[reading.unread]}, so its changed lines are charged`;
  if (reading.verdict === 'values' && reading.names.length > 0) {
    return `values — ${reading.names.join(', ')} changed; their readers and the changed regions are charged`;
  }
  if (reading.verdict === 'values') return 'values — the readers of its changed values are charged';
  if (reading.verdict === 'load' && reading.effects !== undefined) {
    return `load — the \`sideEffects\` field of its package declares ${reading.effects.join(', ')}`;
  }
  return VERDICT[reading.verdict];
}

const VERDICT = {
  none: 'none — the runtime text is equal',
  bodies: 'bodies — the changed regions are charged, not the whole module',
  load: 'load — every test that loaded it is charged',
} as const;

const UNREAD = {
  source: 'no recorded text to read it against',
  hunk: 'the diff does not apply to the recorded text',
  parse: 'one side does not parse',
  addon: 'no native scanner on this machine',
} as const;
