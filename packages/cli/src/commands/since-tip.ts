/**
 * Where a review stands: the commit under review, and its diff in that commit's
 * numbering.
 *
 * Split from `since.ts`, which answers what moved since a ref from the run's
 * own directory; a review asks the same questions from the tip's side.
 */

import { execFile } from 'node:child_process';
import { relative } from 'node:path';
import { promisify } from 'node:util';
import { inCoordinates, mergeBase, NO_DECORATION, PLAIN, topLevel } from './since.js';

/**
 * The diff a review reads, numbered in the commit under review.
 *
 * A pull request's lines are the tip's, and a record made on the tip numbers
 * its regions in the same text, so the lines the change wrote are asked of the
 * record on the tip's side. The hunk reader reads the old side, so the diff is
 * taken reversed: the tip stands where the recorded text would, and the merge
 * base where the edit would.
 *
 * FIXME: the tip side is the working tree, not `HEAD`, so an edit left
 * uncommitted in the checkout a review runs in is numbered as if the suite had
 * run over it. A CI checkout is clean; a developer's is not.
 */
export async function diffAtTip(ref: string): Promise<string | undefined> {
  const run = promisify(execFile);
  const here = process.cwd();
  const repository = await topLevel(run, here);
  try {
    const base = await mergeBase(run, ref, repository);
    const { stdout } = await run('git', [...PLAIN, 'diff', ...NO_DECORATION, '--no-renames', '-R', base], {
      cwd: repository,
      maxBuffer: 64 * 1024 * 1024,
    });
    return inCoordinates(stdout, here, repository);
  } catch {
    return undefined;
  }
}

/** The commit the checkout stands at, or absent outside one. */
export async function headCommit(): Promise<string | undefined> {
  try {
    const { stdout } = await promisify(execFile)('git', ['rev-parse', 'HEAD'], { cwd: process.cwd() });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Where `directory` sits under the top of its checkout, `''` at the top itself. */
export async function repositoryDirectory(directory: string): Promise<string> {
  return relative(await topLevel(promisify(execFile), directory), directory);
}
