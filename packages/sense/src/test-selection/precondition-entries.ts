/**
 * Whether what `preconditions` names can be read as files.
 *
 * An entry is digested when the run ends, so one that cannot be read fails a
 * run whose tests all passed. It is read here instead, when the runner announces
 * the run and before any test starts: a command that only loads the
 * configuration announces nothing and is never asked.
 */

// compass: variance-authority.reach

import { NoDigester, textDigests } from '../text-digests.js';

/** Whether the reader of a precondition reads these. A missing addon says nothing of any file, so it goes through. */
function digest(files: readonly string[]): boolean {
  try {
    textDigests(files);
    return true;
  } catch (failure) {
    if (failure instanceof NoDigester) throw failure;
    return false;
  }
}

/**
 * Refuses every file the run could not digest when it ends, naming them all.
 * Read as one set, the way the run reads it, and entry by entry only to name
 * what failed. Nothing declared asks nothing, so it needs no addon.
 */
export function refuseUnreadable(files: readonly string[]): void {
  if (files.length === 0 || digest(files)) return;
  const named = files.filter((file) => !digest([file])).join(', ');
  throw new Error(
    `preconditions names ${named}, which cannot be read as a file. Each entry is the path of one file that exists before the run starts: ` +
      'name each file of a glob or a directory, and write a generated file before the runner starts; a file a test writes during the run is not a precondition.',
  );
}
