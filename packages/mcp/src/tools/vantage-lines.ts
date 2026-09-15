/**
 * The sentences both live tools share.
 *
 * Its own module for the reason every extracted module here has: the two tools
 * disagreeing about how an announcement is written would make one of them the
 * odd one out in a transcript an agent reads end to end, and the way to stop
 * that is for there to be one spelling rather than a convention.
 */

import type { VantageState, WatchedTest } from '@variance-authority/vantage';

/** One announcement, as a line in a listing. */
export function announcement(event: {
  readonly realm: string;
  readonly location: string;
  readonly subject: string;
  readonly action: string;
  readonly phase: string;
  readonly ordinal: number;
}): string {
  const phase = event.phase === 'once' ? '' : ` (${event.phase})`;
  return `${String(event.ordinal).padStart(4)}  ${event.realm}  ${event.location} / ${event.subject} / ${event.action}${phase}`;
}

/** A test in one line, without what it heard. */
export function heading(test: WatchedTest): string {
  const parts = [test.title, test.file];
  if (test.project !== undefined) parts.push(`project ${test.project}`);
  if (test.worker >= 0) parts.push(`worker ${test.worker}`);
  return parts.join(' — ');
}

/** How much this test has to say, as a phrase. */
export function tally(test: WatchedTest): string {
  const heard =
    test.forgotten === 0
      ? `heard ${test.heard.length}`
      : `heard ${test.heard.length} (+${test.forgotten} forgotten)`;
  return test.pending.length === 0 ? heard : `${heard}, pending ${test.pending.length}`;
}

/**
 * What this test sent from the points its author chose, newest last.
 *
 * Printed here as well as in `variance_test_signals`, because a reader who came
 * to this tool came to decide whether to let a test go, and the note is what the
 * author left for exactly that decision.
 */
export function notesOf(test: WatchedTest): string[] {
  if (test.notes.length === 0) return [];
  return [
    test.forgottenNotes === 0
      ? 'sent:'
      : `sent (the first ${test.forgottenNotes} were dropped to stay bounded):`,
    ...test.notes.map(
      (note) =>
        `  ${note.at}  after ${note.after} announcement(s)  ${note.note === '' ? '(no words)' : note.note}`,
    ),
  ];
}

/**
 * How a run is pointed at this vantage, in the form it goes in.
 *
 * One spelling, said in two places, because the two places are the two moments
 * a reader can act on it: the handshake, before anything has been started, and
 * the empty answer, once something has been started the wrong way. Saying it
 * differently in each would leave a reader comparing two lines to work out
 * whether they are the same instruction.
 *
 * The address is printed verbatim every time. A reader who has to assemble it
 * from a variable name and a port they were told elsewhere is a reader who
 * starts the suite without it.
 */
export function attaching(state: VantageState): string {
  const address = state.address ?? 'http://127.0.0.1:<port>';
  return [
    'A run reports here when it is started with this in its environment:',
    '',
    `  ${VARIABLE}=${address}`,
    '',
    'That is the same env block `VARIANCE_AUTHORITY_EVENTS` goes in. The suite ' +
      'needs `varianceFixtures` from `@variance-authority/playwright-test` and ' +
      'nothing else — a test that takes no screenshot reports exactly what one ' +
      'that does reports, and a run started without the variable pays nothing.',
  ].join('\n');
}

/**
 * What to do when a vantage has heard nothing.
 *
 * A reader told only "no tests" concludes the run has none, or that the tool is
 * broken, and does not discover that attaching is one environment variable.
 */
export function unattached(state: VantageState): string {
  return ['Nothing has reported to this vantage yet.', '', attaching(state)].join('\n');
}

const VARIABLE = 'VARIANCE_AUTHORITY_VANTAGE';
