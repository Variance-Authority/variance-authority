// compass: variance-authority.reach

/**
 * The refusal for a file a record does not hold.
 *
 * A path given to `covering` is usually the right file and the wrong root: the
 * record spells a module the way the run saw it, and a reader who pasted an
 * editor path is one prefix away. The sentence points at recorded files that
 * are this one under another root. The refusal also carries them as data, so a
 * caller tells a suite that tests other code from one that most likely ran this
 * file, without reading the sentence.
 */

import { OperatorError } from '../exit.js';

/** A record that never loaded the file, with the paths it holds of the same file under another root. */
export class UnloadedFile extends OperatorError {
  /** Recorded paths that end in the asked one, or that it ends in, sharing a directory; empty when none does. */
  readonly spelled: readonly string[];

  constructor(message: string, spelled: readonly string[]) {
    super(message, { kind: 'unloaded' });
    this.spelled = spelled;
  }
}

/** Refuse `file`, which the record at `from` does not hold among its `files`. */
export function unloadedFile(file: string, from: string, files: readonly string[]): UnloadedFile {
  return new UnloadedFile(
    `\`${file}\` is not in the index at \`${from}\`, which holds ${files.length} file${
      files.length === 1 ? '' : 's'
    }. A file the run never loaded, or loaded without instrumenting it, has no answer here, and that is a different statement from no test covering it. ${
      spelling(file, files)
    }`,
    rooted(file, files),
  );
}

/**
 * The sentence that points from `file` to the recorded paths of the same file.
 *
 * A recorded path is a spelling of the asked one only when it is this file
 * under another root. One that shares no more than the file name is another
 * file, or this one before it moved, and is named as only sharing it: called a
 * spelling, it sends the reader to ask about a file they did not mean, and to
 * read the record as stale when it is not.
 */
export function spelling(file: string, files: Iterable<string>): string {
  const listed = [...files];
  const near = rooted(file, listed);
  if (near.length > 0) return `The record spells it ${quoted(near)}.`;
  const tail = file.slice(file.lastIndexOf('/') + 1);
  const named = listed.filter((candidate) => candidate === tail || candidate.endsWith(`/${tail}`)).sort();
  return named.length === 0
    ? `Nothing recorded ends in \`${tail}\`.`
    : `No recorded path is this one under another root; ${quoted(named)} only ${
      named.length === 1 ? 'shares' : 'share'
    } its name.`;
}

/** Recorded paths that end in `file`, or that it ends in, at a shared directory. */
function rooted(file: string, files: readonly string[]): string[] {
  // A shared directory makes it the same file under another root; a bare name,
  // asked or recorded, is any file of that name.
  const shorter = (one: string, other: string): boolean => one.includes('/') && other.endsWith(`/${one}`);
  return files.filter((candidate) => shorter(file, candidate) || shorter(candidate, file)).sort();
}

/**
 * Three candidates answer a wrong root; a list of every recorded file answers
 * nothing and scrolls the refusal off the screen.
 */
function quoted(files: readonly string[]): string {
  return files.slice(0, 3).map((candidate) => `\`${candidate}\``).join(', ');
}
