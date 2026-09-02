/**
 * Where the run stands, and what has moved since.
 *
 * Every question `--since` asks is here: which files a ref names, the hunks
 * behind them, and where the recorded execution index stands. They sit together
 * because they share the join nobody sees until it is wrong — `git` names files
 * from the repository root and a run names them from its own directory, and a
 * path that crosses that boundary unconverted is a change the selector cannot
 * match against anything it holds.
 *
 * Split from `resources.ts` because that file answers *what this run needs to
 * open*: a decoder, a store, a cache directory. This one answers *what has
 * changed*, which is a different question asked by a different half of the run.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, relative } from 'node:path';
import { OperatorError } from '../exit.js';

/**
 * Files a diff against `ref` touched, named the way the run names files.
 *
 * `git diff --name-only ref...HEAD` — three dots, so the comparison is against
 * the **merge base** rather than against the tip of the other branch. Two dots on
 * a branch that is behind `main` reports every file anybody else merged as
 * changed here, which would widen a selection to the whole suite for a reason
 * nobody could see.
 *
 * ## Two coordinate systems, and the join between them is the whole feature
 *
 * `git` names files from the repository root, always, whichever directory it was
 * invoked in. The file graph names them from the directory the run was invoked
 * in, because that is what `source.dirs` is relative to. Those agree only when a
 * run happens to start at the top of its own checkout — and when they disagree,
 * *nothing fails*: every changed path simply matches nothing, the graph reports
 * that it reaches no component, and a monorepo package narrows itself to the
 * whole suite or refuses, for a reason no message on the page can show. So the
 * paths are brought into the run's coordinates here, at the one place they cross.
 *
 * `roots` is where to look for the repository, not a filter. A checkout nested
 * under the run — a vendored application, an example's cloned subject — is the
 * only copy of git that has the history being asked about, and asking the outer
 * repository instead answers *nothing changed* about a tree it was told to ignore.
 * Paths outside the run's directory keep their `../` and are handed on as they
 * are: they cannot be in the graph, and dropping them would quietly turn a diff
 * this run cannot see into a diff that touched nothing.
 *
 * A failure is an operator error rather than an empty list. An empty list means
 * *this diff touched nothing*, and answering a broken `git` with it would narrow
 * a run to nothing while reporting success.
 */
export async function changedSince(
  ref: string,
  roots: readonly string[] = [],
): Promise<readonly string[]> {
  const run = promisify(execFile);
  const here = process.cwd();
  const repository = await topLevel(run, roots[0] === undefined ? here : join(here, roots[0]));

  try {
    const { stdout } = await run('git', ['diff', '--name-only', `${ref}...HEAD`], {
      cwd: repository,
      maxBuffer: 32 * 1024 * 1024,
    });

    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .map((file) => relative(here, join(repository, file)));
  } catch (error) {
    throw new OperatorError(
      `\`--since ${ref}\` could not list what changed: ${messageOf(error)}. ` +
        'A run that answered this with an empty diff would narrow itself to nothing and report ' +
        'success, so it refuses instead. Check the ref exists and that this is a git checkout ' +
        '(a shallow CI clone often needs `fetch-depth: 0`).',
    );
  }
}


/**
 * The same diff again, as text — because the second ground reads lines.
 *
 * `changedSince` answers *which files*, which is everything the structural
 * selector needs and nothing the execution journal can use: a journal is indexed
 * by region, and a region is a line range. So this fetches the hunks, with the
 * paths brought into the run's coordinates exactly as the file list is — the two
 * must name one file the same way or the journal answers about a module nobody
 * changed.
 *
 * `undefined` rather than a throw. A repository that cannot produce a diff has
 * already refused the file list a moment earlier with a sentence naming the ref;
 * failing twice for one cause would replace that sentence with this one. And the
 * journal only ever *removes* subjects, so its absence is a wider run, never a
 * quieter one.
 */
export async function diffSince(
  ref: string,
  roots: readonly string[] = [],
): Promise<string | undefined> {
  const run = promisify(execFile);
  const here = process.cwd();
  const repository = await topLevel(run, roots[0] === undefined ? here : join(here, roots[0]));

  try {
    const { stdout } = await run('git', ['diff', `${ref}...HEAD`], {
      cwd: repository,
      maxBuffer: 64 * 1024 * 1024,
    });

    return inCoordinates(stdout, here, repository);
  } catch {
    return undefined;
  }
}


/** Rewrite the two header lines a hunk reader looks at, and leave the rest alone. */
function inCoordinates(diff: string, here: string, repository: string): string {
  return diff
    .split('\n')
    .map((line) => {
      for (const mark of ['--- a/', '+++ b/']) {
        if (!line.startsWith(mark)) continue;
        const path = line.slice(mark.length);
        return `${mark}${relative(here, join(repository, path))}`;
      }
      return line;
    })
    .join('\n');
}


/**
 * Where the recorded execution index stands, and how far the tree is from it.
 *
 * A probe rather than a selector, and the difference decides every failure here.
 * `changedSince` refuses a broken `git` because a run is about to skip subjects
 * on the strength of its answer; nothing is skipped on the strength of this one.
 * It exists so a report can name the coordinate — so an agent reading the run
 * learns that an index is on disk, where it stands, and what `--since` would
 * cost — and a coordinate that cannot be read is simply one the report does not
 * carry.
 *
 * The diff is two-dot and against the working tree, not `...HEAD`. There is no
 * merge base to find: the index names the exact commit it was written at, and
 * the question is what has moved since, uncommitted edits included.
 */
export async function indexPosition(
  root: string,
  roots: readonly string[] = [],
): Promise<{ readonly commit: string; readonly changed: number } | undefined> {
  const run = promisify(execFile);
  const selection = await import('@variance-authority/sense/test-selection');

  try {
    const { commit } = await selection.readTestCoverage(selection.testCoverageFile(root));
    if (commit === undefined) return undefined;
    const repository = await topLevel(run, roots[0] === undefined ? root : join(root, roots[0]));
    const { stdout } = await run('git', ['diff', '--name-only', commit], {
      cwd: repository,
      maxBuffer: 32 * 1024 * 1024,
    });
    const changed = stdout.split('\n').filter((line) => line.trim() !== '').length;
    return { commit, changed };
  } catch {
    return undefined;
  }
}


/**
 * The checkout a directory belongs to, or the run's own directory when none does.
 *
 * A failure here is deliberately not raised. `rev-parse` fails for one uninteresting
 * reason — this is not a git checkout — and the diff that follows is about to fail
 * with a sentence naming the ref the operator actually typed, which is the more
 * useful of the two.
 */
async function topLevel(
  run: (file: string, args: readonly string[], options: object) => Promise<{ stdout: string }>,
  from: string,
): Promise<string> {
  try {
    const { stdout } = await run('git', ['rev-parse', '--show-toplevel'], { cwd: from });
    const found = stdout.trim();
    return found === '' ? process.cwd() : found;
  } catch {
    return process.cwd();
  }
}


function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What a run was asked to narrow by, before any of it has been resolved. */
export interface NarrowingRequest {
  /** `--since <ref>`. */
  readonly since?: string;
  /** `--against <ref>`. */
  readonly against?: string;
  /** Whether a file graph is configured, which is what makes `--since` imply `--against`. */
  readonly relations: boolean;
}

/**
 * Resolve every ref a run was given, and the coordinate it was not.
 *
 * One fetch for both verbs when they name the same ref, and `--since` implies
 * `--against` wherever a graph is configured: the walk has already happened by
 * then, and a run that narrowed itself and could not say why is the one shape
 * worth avoiding.
 *
 * `index` is read whether or not the run narrows, because it is the answer to
 * *what would `--since` have cost* — and a run that never asks cannot put that
 * in the report, which leaves narrowing an option nobody reading the run knows
 * is there. It is carried and never acted on: narrowing is the operator's
 * decision and stays one.
 */
export async function narrowingFor(
  request: NarrowingRequest,
  dirs: readonly string[],
): Promise<{
  readonly since?: { readonly ref: string; readonly changed: readonly string[]; readonly diff?: string };
  readonly against?: { readonly ref: string; readonly changed: readonly string[] };
  readonly index?: { readonly commit: string; readonly changed: number };
}> {
  const diff = request.since === undefined ? undefined : await diffSince(request.since, dirs);
  const since =
    request.since === undefined
      ? undefined
      : {
          ref: request.since,
          changed: await changedSince(request.since, dirs),
          ...(diff === undefined ? {} : { diff }),
        };
  const againstRef = request.against ?? (request.relations ? request.since : undefined);
  const against =
    againstRef === undefined
      ? undefined
      : againstRef === since?.ref
        ? { ref: againstRef, changed: since.changed }
        : { ref: againstRef, changed: await changedSince(againstRef, dirs) };
  const index = await indexPosition(process.cwd(), dirs);

  return {
    ...(since === undefined ? {} : { since }),
    ...(against === undefined ? {} : { against }),
    ...(index === undefined ? {} : { index }),
  };
}
