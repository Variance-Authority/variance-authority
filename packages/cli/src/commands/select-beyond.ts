// compass: variance-authority.reach
/**
 * The install, as the commands hand it to the stages after it.
 *
 * [`beyondReach`](../../../core/src/relate/beyond.ts) reads a bump and a moved
 * manifest back into the repository files they change; this is that reading
 * for an `InstallDiff`, and the patch every reader of a change is then handed:
 * the diff, with each traced file changed whole. No reader of the patch is told
 * a package name. The sentence the selection prints is, because a test the
 * install entered was entered by no changed line, and a reason that says it was
 * names the wrong cause.
 */

import { beyondReach, type BeyondReach, type Relations } from '@variance-authority/core/relate';
import { codeUnitOrder } from '@variance-authority/core/segment';
import { wholeEntry, withoutFiles } from '@variance-authority/sense/test-selection';
import type { InstallDiff } from './installed.js';
import { listed, many } from './reach.js';

/**
 * A lockfile or a manifest that moved since the tests ran, as the files it
 * changed whole. Counts rather than the files, as a selection's `recorded` is.
 */
export interface SelectInstall {
  /** The lockfile compared, as the repository names it, when a bump reached a file. */
  readonly lockfile?: string;
  /** The bumped packages that reached a file, the one that reached the most first. */
  readonly packages: readonly string[];
  /** The manifests whose `exports`, `main` or `type` moved what their importers load. */
  readonly moved: readonly string[];
  /** How many repository files the install changed whole. */
  readonly reached: number;
  /** The sentences naming all of it, among the notes. */
  readonly says: readonly string[];
}

const NOTHING: BeyondReach = { files: [], unplaced: [], traced: [], chains: new Map() };

/**
 * What the install moved, as files. Nothing for no install to compare; an
 * install that cannot be compared is the caller's full run, before this is asked.
 */
export function beyondOf(relations: Relations | undefined, install: InstallDiff | undefined): BeyondReach {
  if (relations === undefined || install === undefined || 'whole' in install) return NOTHING;
  return beyondReach(relations, install);
}

/**
 * The diff with each of `files` changed whole. A file the diff already changed
 * loses its hunks: whole is what the install made of it, and a selector that
 * read both would answer for the hunks alone.
 */
export function withWhole(diff: string, files: readonly string[]): string {
  if (files.length === 0) return diff;
  return [withoutFiles(diff, files), ...files.map(wholeEntry)].join('\n');
}

/**
 * What the install changed whole, said: the lockfile, the packages it resolves
 * differently and the package each was imported through, the moved manifests,
 * and the files they reached. `undefined` when it reached none.
 *
 * Each install is keyed by the stand it was compared from, `undefined` for the
 * journal's own commit, and `from` says where that was. The packages are
 * ordered by the files they reached, most first, so the bump that entered the
 * suite is among the three named when more moved.
 */
export function installReached(
  installs: ReadonlyMap<string | undefined, InstallDiff | undefined>,
  beyond: ReadonlyMap<string | undefined, BeyondReach>,
  from: (stand: string | undefined) => string,
): SelectInstall | undefined {
  const reaching = [...beyond].filter(([, one]) => one.files.length > 0);
  if (reaching.length === 0) return undefined;

  // The chain of every file a bump reached runs from the bumped package to the one the file imports.
  const chains = new Map(reaching.flatMap(([, one]) => [...one.chains]));
  const bumped = [...chains.keys()].sort(codeUnitOrder);
  const reachedBy = (name: string) => bumped.filter((file) => chains.get(file)![0] === name);
  const packages = [...new Set(reaching.flatMap(([, one]) => one.traced))]
    .map((name) => ({ name, files: reachedBy(name) }))
    .sort((left, right) => right.files.length - left.files.length || codeUnitOrder(left.name, right.name));
  const named = packages.map(({ name, files }) => {
    const imported = mostFirst(files.map((file) => chains.get(file)!.at(-1)!).filter((last) => last !== name));
    return imported.length === 0 ? name : `${name} through ${listed(imported)}`;
  });

  const files = new Set(reaching.flatMap(([, one]) => one.files));
  const besides = [...files].filter((file) => !chains.has(file)).sort(codeUnitOrder);
  const unplaced = new Set(reaching.flatMap(([, one]) => one.unplaced));
  const moved = [...new Set(reaching.flatMap(([stand]) => compared(installs.get(stand))?.moved ?? []))]
    .filter((manifest) => !unplaced.has(manifest))
    .sort(codeUnitOrder);
  const lockfile = reaching.map(([stand]) => compared(installs.get(stand))?.lockfile).find((file) => file !== undefined);
  const where = listed([...new Set(reaching.filter(([, one]) => one.traced.length > 0).map(([stand]) => from(stand)))]);

  const says: string[] = [];
  if (packages.length > 0) {
    says.push(
      `${lockfile ?? 'the install'} resolves ${many(packages.length, 'package')} differently than ${where} ` +
        `(${listed(named)}), so ${many(bumped.length, 'file')} importing ${packages.length === 1 ? 'it' : 'them'} ` +
        `(${listed(bumped)}) ${bumped.length === 1 ? 'was' : 'were'} read as changed whole`,
    );
  }
  if (besides.length > 0 && moved.length > 0) {
    const one = moved.length === 1;
    says.push(
      `${listed(moved)} ${one ? 'moves' : 'move'} what ${one ? 'its' : 'their'} importers load, so ` +
        `${many(besides.length, 'file')} beside ${one ? 'it' : 'them'} (${listed(besides)}) ` +
        `${besides.length === 1 ? 'was' : 'were'} read as changed whole`,
    );
  }

  return {
    ...(lockfile === undefined || packages.length === 0 ? {} : { lockfile }),
    packages: packages.map(({ name }) => name),
    moved,
    reached: files.size,
    says,
  };
}

/** Each distinct name once, the most frequent first. */
function mostFirst(names: readonly string[]): readonly string[] {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].sort(([l, a], [r, b]) => b - a || codeUnitOrder(l, r)).map(([name]) => name);
}

/** An install comparison that was made, or `undefined` for one there was nothing to make. */
export function compared(installed: InstallDiff | undefined): Exclude<InstallDiff, { readonly whole: string }> | undefined {
  return installed === undefined || 'whole' in installed ? undefined : installed;
}
