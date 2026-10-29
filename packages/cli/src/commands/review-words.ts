// compass: variance-authority.reach.crossings
/**
 * What each reach is called, in every review a reader sees: the mark a table,
 * a fold and the diagram paint, the few words a pointer says, the sentence the
 * text prints, and the legend under the comment's first table. One table per
 * register, keyed by the reach the record decided, so no renderer words a
 * reach its own way and two of them cannot say two facts of one region.
 */

import type { Reach } from './review.js';

/** Each answer in a few words, for a line that names a place: the handover's pointers. */
export const REACH_WORD: Readonly<Record<Reach, string>> = {
  near: 'near',
  far: 'far',
  unplaced: 'distance not measured',
  loaded: 'ran only while its module loaded',
  overwritten: 'not known',
  hole: 'no case',
  unwalked: 'no case',
  unknown: 'no case',
};

/** Each answer as the text review's count and detail lines say it. */
export const REACH_TEXT: Readonly<Record<Reach, string>> = {
  near: 'covered by a test that imports the file, or is the file',
  far: 'covered only by tests further than one import away',
  unplaced: 'covered by tests the import graph does not hold, so how far is not known',
  loaded: 'ran only while its module loaded',
  overwritten: 'no case is known to have covered it: a case ran it in a text an edit wrote over',
  hole: 'no case covered it, and a case that could have stopped first',
  unwalked: 'no case covered it',
  unknown: 'no case covered it, and the record cannot say whether one stopped first',
};

/**
 * One mark per answer, so a row in the table and a count in the per-file fold
 * read the same way: red is changed code no case covered, yellow and orange are
 * covered from further away than the file's own importers, green is covered
 * from one import away, white ran only while its module loaded, and the
 * question mark is code a case ran in a text an edit wrote over.
 */
export const MARK: Readonly<Record<Reach, string>> = {
  near: '🟢',
  far: '🟡',
  unplaced: '🟠',
  loaded: '⚪',
  overwritten: '❔',
  hole: '🔴',
  unwalked: '🔴',
  unknown: '🔴',
};

/** What each mark says, once, under the first table that uses it. */
export const LEGEND = '🟢 a test importing the file ran it · 🟡 only tests further away ran it · 🟠 tests outside the import graph ran it · ' +
  '⚪ ran only while its module loaded · ❔ no case is known to have run it · 🔴 no case ran it';

/** What code a case ran in a text an edit wrote over is: run by a case nobody can name, in this run or in the record. */
export function notKnown(ran: boolean): string {
  return `no case${ran ? '' : ' in the record'} is known to have run`;
}

/** Code this change wrote that no run has reached yet: read before it ran, so no case was expected. */
export const FRESH_MARK = '🔵';
