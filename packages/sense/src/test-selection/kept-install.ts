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
import type { CommitRuns } from './commit-runs.js';
import { keepText, type KeptTexts, type LandedTree } from './kept-texts.js';
import { codeUnitOrder } from './instrumented-modules.js';
import { agreed, landingsOf } from './landings.js';

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
 * Keep the text of every lockfile and manifest in `tree` that git says
 * differs from `HEAD`, and say which.
 *
 * `undefined` when the install cannot be said: no tree, which is outside a
 * checkout or git not answering, or a text that could not be read or kept. A reader takes
 * that for no record, which compares from the commit as before. Never throws.
 */
export async function keepRecordedInstall(tree: LandedTree | undefined): Promise<KeptInstall | undefined> {
  // FIXME: the install is read when the run lands, after its tests ran, so an
  // install edited during the run is kept as if the tests had run on it.
  if (tree === undefined) return undefined;
  const { repository, top, changes } = tree;
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

/** A shard's tests and the runs record its own landing left, as a fold of shards reads them. */
export interface ShardRuns {
  readonly tests: { readonly commit?: string; readonly tests: readonly { readonly file: string }[] };
  readonly runs: Pick<CommitRuns, 'commit' | 'runs' | 'files' | 'first' | 'latest' | 'installed' | 'landings'> | undefined;
}

/**
 * The install a fold of `shards` ran on, read off the runs record each shard's
 * own landing left beside its snapshot, which {@link keepRecordedInstall} kept
 * where that shard ran.
 *
 * A shard's install speaks for the fold's tests from that shard only when its
 * record names the commit the shard's snapshot stands at, lists a run there
 * that observed every test the snapshot holds, and names an install. When
 * every shard's does and all of them name one install, that is the fold's.
 * Otherwise the fold ran on an install nobody can name, as runs at one commit
 * over two installs did (`agreed` in `landings.ts`): `undefined`, which a
 * reader compares from the commit.
 */
export function shardsInstall(shards: readonly ShardRuns[]): KeptInstall | undefined {
  return shardsKept(shards, (runs) => runs.installed);
}

/**
 * The texts a fold of `shards` ran over where the shards' commit does not hold
 * them, read as {@link shardsInstall} reads the install: the shards' own
 * records, when every one observed its whole snapshot and its landings name
 * one set (`agreed`), and all name the same.
 */
export function shardsTexts(shards: readonly ShardRuns[]): KeptTexts | undefined {
  return shardsKept(shards, (runs) => agreed(landingsOf(runs), (landing) => landing.texts));
}

function shardsKept<Kept extends KeptInstall>(shards: readonly ShardRuns[], of: (runs: NonNullable<ShardRuns['runs']>) => Kept | undefined): Kept | undefined {
  let kept: Kept | undefined;
  for (const { tests, runs } of shards) {
    const its = runs === undefined ? undefined : of(runs);
    if (runs === undefined || its === undefined || runs.runs === 0 || tests.commit === undefined || runs.commit !== tests.commit) return undefined;
    // A record read off disk is a JSON object, its fields as written: files that are not a list name no test.
    if (!Array.isArray(runs.files)) return undefined;
    const ran = new Set(runs.files);
    if (!tests.tests.every((test) => ran.has(test.file))) return undefined;
    if (kept !== undefined && !sameInstall(kept, its)) return undefined;
    kept = its;
  }
  return kept;
}

/**
 * `value` as an install, read off a runs record: an object naming each path
 * with a digest or `null`. Anything else is `undefined`, which a reader takes
 * for an install it does not know and compares from the commit.
 */
export function keptInstallOf(value: unknown): KeptInstall | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const fine = Object.values(value).every((digest) => digest === null || typeof digest === 'string');
  return fine ? (value as KeptInstall) : undefined;
}

/**
 * `install` as one string: two installs that name the same paths with the same
 * texts give the same key, whatever order their paths were written in.
 */
export function installKey(install: KeptInstall): string {
  return JSON.stringify(Object.entries(install).sort(([a], [b]) => codeUnitOrder(a, b)));
}

/** Whether two installs name the same paths with the same texts. */
export function sameInstall(a: KeptInstall, b: KeptInstall): boolean {
  return installKey(a) === installKey(b);
}
