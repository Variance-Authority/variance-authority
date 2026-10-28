/**
 * What `variance select` says beside its skip list about the files it read no
 * further: unread, declined, ignored, and recorded from a text nobody kept.
 */

// compass: variance-authority.reach

import { many } from './prose-counts.js';

/**
 * The changed paths the journal records nothing about, argued at the top of
 * `select.ts`.
 *
 * Named rather than counted, because the one an operator acts on is a fixture a
 * test reads without importing it, and that is recognised by its name.
 */
export function unreadNotes(unread: readonly string[]): readonly string[] {
  if (unread.length === 0) return [];
  return [
    `the journal records nothing about ${many(unread.length, 'changed file')} ` +
      `(${unread.slice(0, 3).join(', ')}${unread.length > 3 ? ', …' : ''}), so ` +
      `${unread.length === 1 ? 'it keeps' : 'they keep'} no test in the run; a file the suite ` +
      'reads without importing it is declared as a precondition',
  ];
}

/**
 * The changed files a suite declining relations did not measure. The graph was
 * not asked, so they are not said to be recorded nowhere: the suite said where
 * its unmeasured files go, and what it rests on is its `before`.
 */
export function declinedNotes(declined: readonly string[]): readonly string[] {
  if (declined.length === 0) return [];
  return [
    `the suite declines relations, so ${many(declined.length, 'changed file')} its record did not measure ` +
      `(${declined.slice(0, 3).join(', ')}${declined.length > 3 ? ', …' : ''}) ` +
      `${declined.length === 1 ? 'keeps' : 'keep'} no test in the run; a file the suite rests on is declared in its \`before\``,
  ];
}

/** The changed files the suite's `ignore` matched, which were never read. */
export function ignoredNotes(ignored: readonly string[]): readonly string[] {
  if (ignored.length === 0) return [];
  return [
    `the suite ignores ${many(ignored.length, 'changed file')} ` +
      `(${ignored.slice(0, 3).join(', ')}${ignored.length > 3 ? ', …' : ''}) by its \`ignore\`, ` +
      `so only a test that declares ${ignored.length === 1 ? 'it' : 'one'}, as a precondition or by a \`/// <depends>\`, runs for ${ignored.length === 1 ? 'it' : 'them'}`,
  ];
}

/**
 * What the recording says about itself, which outlives whichever way the answer
 * went.
 *
 * `stale` has already widened the reading — every region of such a module was
 * charged — so it cannot make the skip list wrong. It is printed because it is
 * the one number here an operator can read the recording by: it counts modules
 * recorded from a text the commit does not hold and the cache did not keep. A
 * landing keeps the text of every module it recorded over an edit, so what is
 * left is a text edited again while the suite ran, a run landed before texts
 * were kept, or a cache cleared since; the next run that loads the module
 * records it again.
 */
export function recordingNotes(
  stale: readonly string[],
  commit: string | undefined,
  given: boolean,
): readonly string[] {
  const notes: string[] = [];

  if (commit === undefined && !given) {
    notes.push(
      'the journal names no commit, so none of its line ranges could be checked against the ' +
        'text they were cut from; every changed module with a row was charged whole',
    );
  }

  if (stale.length > 0) {
    const [first] = stale;
    notes.push(
      `${many(stale.length, 'changed module')} ${stale.length === 1 ? 'was' : 'were'} recorded ` +
        `from a text the journal's own commit does not hold and the cache did not keep (${first}), ` +
        `so every region of ${stale.length === 1 ? 'it' : 'them'} was charged rather than read; the ` +
        `next run that loads ${stale.length === 1 ? 'it' : 'them'} records ${stale.length === 1 ? 'it' : 'them'} again`,
    );
  }

  return notes;
}
