/**
 * Where the index is, in time and space.
 *
 * There is one master branch. Everything else is that branch plus a diff, or
 * minus one where a checkout is behind, and either way the question a selector
 * asks is *what changed since the index was written*. A commit answers it
 * exactly and nothing else does: a digest per module says which files differ but
 * not from what, and a timestamp says when a machine was, not where a tree was.
 *
 * So the index carries the commit it was recorded at, and that is the whole of
 * its position. No lineage is walked, no merge base is computed and no distance
 * is scored — the diff between that commit and the working tree is the distance,
 * and git already computes it.
 *
 * ## Why the position is not checked for cleanliness here
 *
 * A recording is made by *running* the suite, and the tree a suite runs over is
 * dirty far more often than clean, so this writes the commit of a tree that
 * mostly does not match it. That is deliberate, and the check lives elsewhere
 * for a reason: a `--porcelain` here would answer *this tree was dirty* and cost
 * the whole recording its position, where the per-module digest the recorder
 * already writes answers *this module was dirty* and costs only that module. A
 * hundred clean modules still narrow by region beside one that cannot, which a
 * tree-wide flag cannot express. `select.ts` asks that question, per module, of
 * whatever text the caller can fetch from the position written here.
 *
 * Failure here is not an error. A directory that is not a checkout, a repository
 * with no commit yet, a `git` that is not installed — each leaves the index with
 * no position, which is the honest record of one. A caller holding an index that
 * cannot say where it is has nothing to diff against and must run everything,
 * which is the direction this whole subsystem is allowed to fail in.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/** The commit a recording is being made at, or nothing when there is no answer. */
export async function commitOf(root: string): Promise<string | undefined> {
  try {
    const { stdout } = await promisify(execFile)('git', ['rev-parse', 'HEAD'], { cwd: root });
    const found = stdout.trim();
    return found === '' ? undefined : found;
  } catch {
    return undefined;
  }
}
