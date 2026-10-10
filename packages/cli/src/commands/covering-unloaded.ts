// compass: variance-authority.reach

/**
 * The refusal for a file a record does not hold.
 *
 * A path given to `covering` is usually the right file and the wrong root: the
 * record spells a module the way the run saw it, and a reader who pasted an
 * editor path is one prefix away. The refusal carries the closest spellings as
 * data, so a caller tells a suite that tests other code from one that ran this
 * file under another name without reading the sentence.
 */

import { OperatorError } from '../exit.js';

/** A record that never loaded the file, with the spellings it holds of the same name. */
export class UnloadedFile extends OperatorError {
  /** Up to three recorded files whose name is the asked file's, closest first; empty when none is. */
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
  const spelled = files
    .filter((candidate) => candidate === tail || candidate.endsWith(`/${tail}`))
    .sort()
    .slice(0, 3);
  return new UnloadedFile(
    `\`${file}\` is not in the index at \`${from}\`, which holds ${files.length} file${
      files.length === 1 ? '' : 's'
    }. A file the run never loaded has no answer here, and that is a different statement from no test covering it. ${
      spelled.length === 0
        ? `Nothing recorded ends in \`${tail}\`.`
        : `The record spells it ${spelled.map((candidate) => `\`${candidate}\``).join(', ')}.`
    }`,
    spelled,
  );
}
