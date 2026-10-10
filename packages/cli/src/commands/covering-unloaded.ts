// compass: variance-authority.reach

/**
 * The refusal for a file a record does not hold.
 *
 * A path given to `covering` is usually the right file and the wrong root: the
 * record spells a module the way the run saw it, and a reader who pasted an
 * editor path is one prefix away. The sentence points at recorded files of the
 * same name. The refusal also carries, as data, the recorded paths that are this
 * path under another root, so a caller tells a suite that tests other code from
 * one that most likely ran this file, without reading the sentence.
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
  const tail = file.slice(file.lastIndexOf('/') + 1);
  // Three candidates answer a wrong root; a list of every recorded file answers
  // nothing and scrolls the refusal off the screen.
  const named = files
    .filter((candidate) => candidate === tail || candidate.endsWith(`/${tail}`))
    .sort()
    .slice(0, 3);
  // A shared directory makes it the same file under another root; a bare name
  // at a record's root is any file of that name.
  const rooted = files
    .filter((candidate) => candidate.endsWith(`/${file}`) || (candidate.includes('/') && file.endsWith(`/${candidate}`)))
    .sort();
  return new UnloadedFile(
    `\`${file}\` is not in the index at \`${from}\`, which holds ${files.length} file${
      files.length === 1 ? '' : 's'
    }. A file the run never loaded has no answer here, and that is a different statement from no test covering it. ${
      named.length === 0
        ? `Nothing recorded ends in \`${tail}\`.`
        : `The record spells it ${named.map((candidate) => `\`${candidate}\``).join(', ')}.`
    }`,
    rooted,
  );
}
