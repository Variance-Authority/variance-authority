/**
 * Whether what `preconditions` names can be read as files.
 *
 * An entry is digested when the run ends, so one that cannot be read fails a
 * run whose tests all passed. It is read here instead, when the runner announces
 * the run and before any test starts: a command that only loads the
 * configuration announces nothing and is never asked.
 */

// compass: variance-authority.reach

import { accessSync, constants, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DeclaredEntry } from './selection-run.js';

/** The entries as paths from `from`. Nothing is read: a wrapped configuration may run no test. */
export function declaredEntries(entries: readonly string[] | undefined, from: string): readonly DeclaredEntry[] {
  return (entries ?? []).map((entry) => ({ entry, file: resolve(from, entry) }));
}

function readsAsFile(file: string): boolean {
  try {
    accessSync(file, constants.R_OK);
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/** Throws for every entry the disk does not hold as a readable file, named both ways. */
export function refuseUnreadable(declared: readonly DeclaredEntry[]): void {
  const refused = declared.filter(({ file }) => !readsAsFile(file));
  if (refused.length === 0) return;
  const named = refused.map(({ entry, file }) => `${JSON.stringify(entry)} (${file})`).join(', ');
  throw new Error(`preconditions names ${named}, which cannot be read as a file. Each entry is the path of one file that exists before the run starts: name each file of a glob or a directory, and write a generated file before the runner starts; a file a test writes during the run is not a precondition.`);
}
