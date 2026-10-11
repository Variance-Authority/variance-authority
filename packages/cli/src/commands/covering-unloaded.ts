// compass: variance-authority.reach

/**
 * The refusal for a file a record does not hold.
 *
 * It names the asked path and nothing else. Two paths are two files: a
 * recorded path that shares the asked one's name, or ends in it, is another
 * file, and offering it sends the reader to ask about code they did not mean.
 */

import { OperatorError } from '../exit.js';

/** Refuse `file`, which the record at `from` does not hold among its `files`. */
export function unloadedFile(file: string, from: string, files: readonly string[]): OperatorError {
  return new OperatorError(
    `\`${file}\` is not in the index at \`${from}\`, which holds ${files.length} file${
      files.length === 1 ? '' : 's'
    }. A file the run never loaded has no answer here, and that is a different statement from no test covering it.`,
    { kind: 'unloaded' },
  );
}
