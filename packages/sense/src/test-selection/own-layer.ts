/**
 * Which rows of a checkout's record are its own, and which milestone the rest
 * are read from.
 *
 * A checkout's record is one file, because every query reads it and a join
 * per read is the cost `format-layer.ts` exists to avoid. That file folds two
 * things together: the mainline's record the first run was laid on, and every
 * run this checkout landed since. Folded, nothing says which rows are which,
 * and a newer mainline record has nothing to replace. So beside the record
 * sits its ledger, `coverage.layer.json`:
 *
 * - `pinned`: the milestone the record stands on, the mainline's commit as it
 *   was fetched. Absent when the record was laid from the primary checkout's,
 *   which is no milestone.
 * - `ran`: the tests this checkout ran, grouped by the state each ran over,
 *   the latest landing last. A state is the commit, and when the run was made
 *   over uncommitted edits, the git tree of the working state as its name. The
 *   tree only names the state: the module digests in the record's rows decide
 *   whether a module changed since, and a tree `git gc` collected loses
 *   nothing.
 *
 * Every test the record holds and `ran` does not list is the milestone's. The
 * file is the record's: written by every writer of the record, and replaced
 * with it. A record with no ledger beside it was written before there was one,
 * and says nothing about whose its rows are.
 */

// compass: variance-authority.reach

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { codeUnitOrder } from './instrumented-modules.js';
import { writeCoverageBytes } from './record-location.js';

/** The ledger beside a checkout's record. */
export interface OwnLayer {
  /** The milestone the record stands on, as `fetched.json` named it. */
  readonly pinned?: { readonly mainline: string; readonly commit: string };
  /** The tests this checkout ran, by the state they ran over, the latest landing last. A test is in one entry. */
  readonly ran: readonly OwnState[];
}

/** Tests one or more runs of this checkout observed over one state. */
export interface OwnState {
  readonly commit: string;
  /** The git tree of the working state, when the run was made over uncommitted edits. */
  readonly tree?: string;
  /** In code-unit order. */
  readonly files: readonly string[];
}

/** Where the ledger of the record at `coverageFile` is kept. */
export function ownLayerFile(coverageFile: string): string {
  const stem = coverageFile.endsWith('.bin') ? coverageFile.slice(0, -'.bin'.length) : coverageFile;
  return `${stem}.layer.json`;
}

/** The ledger beside `coverageFile`, or `undefined` when there is none or it does not read as one. */
export async function readOwnLayer(coverageFile: string): Promise<OwnLayer | undefined> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(ownLayerFile(coverageFile), 'utf8'));
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null || !Array.isArray((value as OwnLayer).ran)) return undefined;
  const { pinned, ran } = value as OwnLayer;
  const states = ran.filter(
    (state) => typeof state?.commit === 'string' && Array.isArray(state.files) && state.files.every((file) => typeof file === 'string'),
  );
  if (states.length !== ran.length) return undefined;
  return {
    ...(typeof pinned?.mainline === 'string' && typeof pinned.commit === 'string'
      ? { pinned: { mainline: pinned.mainline, commit: pinned.commit } }
      : {}),
    ran: states.map((state) => ({ commit: state.commit, ...(typeof state.tree === 'string' ? { tree: state.tree } : {}), files: state.files })),
  };
}

export async function writeOwnLayer(coverageFile: string, layer: OwnLayer): Promise<void> {
  await writeCoverageBytes(ownLayerFile(coverageFile), Buffer.from(`${JSON.stringify(layer, null, 2)}\n`));
}

/**
 * `layer` once a run over `state` observed `files`: they leave the state they
 * stood in, and join `state`, which moves to the end. An entry left with no
 * file is dropped.
 */
export function ownLayerAfter(layer: OwnLayer, state: Omit<OwnState, 'files'>, files: readonly string[]): OwnLayer {
  const observed = new Set(files);
  const same = (entry: OwnState): boolean => entry.commit === state.commit && entry.tree === state.tree;
  const joined = [...new Set([...(layer.ran.find(same)?.files ?? []), ...files])].sort(codeUnitOrder);
  const others = layer.ran
    .filter((entry) => !same(entry))
    .map((entry) => ({ ...entry, files: entry.files.filter((file) => !observed.has(file)) }))
    .filter((entry) => entry.files.length > 0);
  return {
    ...(layer.pinned === undefined ? {} : { pinned: layer.pinned }),
    ran: joined.length === 0 ? others : [...others, { ...state, files: joined }],
  };
}

/** Every test `layer` says this checkout ran. */
export function ownTests(layer: OwnLayer): ReadonlySet<string> {
  return new Set(layer.ran.flatMap((state) => state.files));
}

/**
 * The git tree of the working state of `repository`, untracked files included
 * and ignored ones not, written through a copy of the index so the user's own
 * is never touched. `undefined` when it is HEAD's own tree, or git cannot
 * write one.
 */
export function workingTree(repository: string): string | undefined {
  let scratch: string | undefined;
  try {
    const index = execFileSync('git', ['rev-parse', '--git-path', 'index'], { cwd: repository, encoding: 'utf8' }).trim();
    scratch = mkdtempSync(join(tmpdir(), 'variance-tree-'));
    const copy = join(scratch, 'index');
    copyFileSync(resolve(repository, index), copy);
    const env = { ...process.env, GIT_INDEX_FILE: copy };
    execFileSync('git', ['add', '-A'], { cwd: repository, env, stdio: 'ignore' });
    const tree = execFileSync('git', ['write-tree'], { cwd: repository, env, encoding: 'utf8' }).trim();
    const committed = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: repository, encoding: 'utf8' }).trim();
    return tree === committed ? undefined : tree;
  } catch {
    return undefined;
  } finally {
    if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
  }
}
