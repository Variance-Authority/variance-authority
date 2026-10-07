/**
 * The install a run ran on, kept when its commit does not hold it.
 *
 * A selection compares the lockfile on disk with the one its tests ran on, and
 * answers each package that moved with the measured files that import it. The
 * commit on a recording's label holds that lockfile only when the tree was
 * clean, and a suite is recorded by being run: bump, `yarn test`, then commit.
 * Compared from the commit, a bump the tests already ran on reads as a change
 * they never saw, and every test that loaded the package runs again until the
 * bump is committed and recorded over; a bump undone after the run reads as no
 * change at all.
 *
 * So the landing keeps it, the way it keeps the text of an edited module
 * (`kept-texts.ts`): for each lockfile and `package.json` git says differs from
 * `HEAD`, the text on disk is written to the layer's `.texts/`, named by its
 * digest, and the runs record names each path with that digest, or with `null`
 * for one the run had deleted. Those are the files the install comparison
 * reads. A path the record does not name is the commit's.
 *
 * No other file is kept: a `.npmrc` or a workspace file moves the install only
 * through the lockfile, which says what it resolved to.
 */

// compass: variance-authority.reach

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { digestString } from '../digest.js';
import { LOCKFILES } from '../lock/read.js';
import { workingTreeChanges } from '../working-tree-changes.js';
import { repositoryLayers } from './cache-layers.js';
import { keepText } from './kept-texts.js';
import { codeUnitOrder } from './instrumented-modules.js';
import { repositoryRoot } from './repository-root.js';

/**
 * Each install file that differed from the run's commit when it ran, named from
 * the top of the checkout: the digest of its text, or `null` for a file the run
 * had deleted. Empty is the commit's install exactly.
 */
export type KeptInstall = Readonly<Record<string, string | null>>;

const INSTALL_FILES: ReadonlySet<string> = new Set([...LOCKFILES, 'package.json']);

/** Whether the install comparison reads `path`: a lockfile, or a manifest. */
function readByInstall(path: string): boolean {
  return INSTALL_FILES.has(path.slice(path.lastIndexOf('/') + 1));
}

/**
 * Keep the text of every lockfile and manifest under `root`'s checkout that
 * git says differs from `HEAD`, and say which.
 *
 * `undefined` when the install cannot be said: outside a checkout, when git
 * does not answer, or when a text could not be read or kept. A reader takes
 * that for no record, which compares from the commit as before. Never throws.
 */
export async function keepRecordedInstall(root: string, cacheRoot?: string): Promise<KeptInstall | undefined> {
  let repository: string;
  let top: string;
  try {
    repository = repositoryRoot(root);
    ({ top } = repositoryLayers(repository, cacheRoot));
  } catch {
    return undefined;
  }
  const changes = await workingTreeChanges(repository, '');
  if (changes === undefined) return undefined;
  const kept: Record<string, string | null> = {};
  for (const path of changes.gone.filter(readByInstall)) kept[path] = null;
  for (const path of changes.changed.filter(readByInstall)) {
    let text: string;
    try {
      text = await readFile(resolve(repository, path), 'utf8');
    } catch {
      return undefined;
    }
    const digest = digestString(text);
    if (!(await keepText(top, digest, text))) return undefined;
    kept[path] = digest;
  }
  return Object.fromEntries(Object.entries(kept).sort(([a], [b]) => codeUnitOrder(a, b)));
}

/**
 * The install the runs at one commit ran on, once a run over `install` adds
 * `files` to the runs `held` already lists there.
 *
 * Runs over one install keep it. A run that observed every test the earlier
 * runs did speaks for all of them, and its install is the record's. Otherwise
 * the runs at this commit ran on two installs, and no one of them is the
 * install a later change is compared from: the record names none, and a reader
 * compares from the commit, as it does for a record written before installs
 * were kept.
 */
export function installAfter(
  held: { readonly files: readonly string[]; readonly installed?: KeptInstall },
  files: readonly string[],
  install: KeptInstall | undefined,
): KeptInstall | undefined {
  if (install === undefined) return undefined;
  if (held.installed !== undefined && sameInstall(held.installed, install)) return install;
  const ran = new Set(files);
  return held.files.every((file) => ran.has(file)) ? install : undefined;
}

function sameInstall(a: KeptInstall, b: KeptInstall): boolean {
  const paths = Object.keys(a);
  return paths.length === Object.keys(b).length && paths.every((path) => path in b && a[path] === b[path]);
}
