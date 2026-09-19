/**
 * Which reader a lockfile gets, and what it means when none of them fits.
 *
 * Dispatch is by file name, then by content where one name covers two formats.
 * Nothing here sniffs: a project has exactly one of these files, its name says
 * which package manager wrote it, and guessing a format from a body that failed
 * to parse as its own would be a way to produce a confident wrong answer out of
 * a broken file.
 */

import type { Lockfile } from './lockfile.js';
import { readNpm } from './npm.js';
import { readPnpm } from './pnpm.js';
import { isBerry, readYarnBerry, readYarnClassic } from './yarn.js';
import { Unreadable } from './yaml.js';

/**
 * The lockfile names this reads, in the order a caller should look for them.
 *
 * A repository with two of them has switched managers and not finished; the
 * first found wins, and the tie is broken the way the managers themselves break
 * it — the one whose own manager would refuse to ignore it.
 */
export const LOCKFILES = ['pnpm-lock.yaml', 'yarn.lock', 'package-lock.json', 'npm-shrinkwrap.json'] as const;

/**
 * Read one lockfile's text. Throws {@link Unreadable} with a sentence naming
 * what stopped it.
 *
 * `fileName` may be a path; only its last segment is read.
 */
export function readLockfile(fileName: string, text: string): Lockfile {
  const name = fileName.slice(fileName.lastIndexOf('/') + 1);

  switch (name) {
    case 'pnpm-lock.yaml':
      return readPnpm(text);
    case 'yarn.lock':
      return isBerry(text) ? readYarnBerry(text) : readYarnClassic(text);
    case 'package-lock.json':
    case 'npm-shrinkwrap.json':
      return readNpm(text);
    default:
      throw new Unreadable(
        `${name} is not a lockfile this reads; it reads ${LOCKFILES.join(', ')}`,
      );
  }
}
