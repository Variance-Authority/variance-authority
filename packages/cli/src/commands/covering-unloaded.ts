// compass: variance-authority.reach

/**
 * The answer for a file a record holds no line of: the test files that loaded
 * it, or a refusal when none did.
 *
 * A module the run loaded without instrumenting it has a row with no blocks,
 * and every test file that loaded it holds it as a precondition. That is what
 * `variance select` reads for it, so a change to it selects every one of those
 * files whole, and `covering` names the same files from the same table
 * (`held-as-precondition.ts`). No case and no line is named: nothing measured
 * them. A record whose coverage does not read cannot say whether any test file
 * loaded it, and is refused as that, not as a file the run never loaded.
 *
 * It names the asked path and nothing else. Two paths are two files: a
 * recorded path that shares the asked one's name, or ends in it, is another
 * file, and offering it sends the reader to ask about code they did not mean.
 */

import { OperatorError } from '../exit.js';

/** Refuse `file`, which the record at `from`, holding `count` files, does not hold. */
export function unloadedFile(file: string, from: string, count: number): OperatorError {
  return new OperatorError(
    `\`${file}\` is not in the index at \`${from}\`, which holds ${count} file${
      count === 1 ? '' : 's'
    }, each named from the repository root. A file the run never loaded has no answer here, and that is a different statement from no test covering it.`,
    { kind: 'unloaded' },
  );
}

/**
 * Refuse `file`, which the record at `from` does not hold because the commit
 * it was made at, `commit`, did not hold the file. That is a record older than
 * the file, not a run that never loaded it, so it carries no `unloaded` kind:
 * the next run of the suite is what answers it.
 */
export function addedSince(file: string, from: string, commit: string): OperatorError {
  return new OperatorError(
    `\`${file}\` did not exist at ${commit.slice(0, 12)}, the commit the record at \`${from}\` was made at, ` +
      'so that record has no answer for it: run the suite and ask again.',
  );
}

/**
 * Refuse `file`, which the index at `from` does not hold, when `from` is a
 * coverage record whose coverage cannot be read: it kept cases and no coverage,
 * or its coverage does not decode. Its preconditions are where a module the
 * run loaded without instrumenting it is kept, so the record cannot say whether
 * a test file loaded this one, and the refusal does not say the run never did:
 * it carries no `unloaded` kind for a caller to act on.
 */
export function unreadPreconditions(file: string, from: string): OperatorError {
  return new OperatorError(
    `\`${file}\` is not in the index at \`${from}\`, and that record's coverage cannot be read, so whether ` +
      'a test file loaded it without instrumenting it is not known.',
  );
}

/** The test files that hold `file` as a precondition (`heldAsPrecondition`), said for a person, one to a line. */
export function preconditionText(file: string, tests: readonly string[]): string {
  if (tests.length === 0) {
    return `No test file of these cases holds ${file} as a precondition: the run loaded it without instrumenting it, ` +
      'or the suite declares it, so no line of it has a recorded case.';
  }
  return [
    `${file} is a precondition of ${tests.length} test file${tests.length === 1 ? '' : 's'}, and a change to it ` +
      'selects every one: the run loaded it without instrumenting it, or the suite declares it, so no line of it ' +
      'has a recorded case.',
    ...tests.map((test) => `  ${test}`),
  ].join('\n');
}
