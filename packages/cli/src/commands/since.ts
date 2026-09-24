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
import { installDiff, type DiffPoint } from './installed.js';
import type { InstallDiff } from './reach.js';

/**
 * Files a diff against `ref` touched, named the way the run names files.
 *
 * The comparison is against the **merge base** of `ref` and `HEAD`, never
 * against the tip of the other branch: on a branch that is behind `main`, the
 * tip reports every file anybody else merged as changed here, which would widen
 * a selection to the whole suite for a reason nobody could see. And it is
 * against the working tree, not `HEAD`. A watch loop asks about the edit that
 * was just saved, and `ref...HEAD` answers about the last commit instead — an
 * uncommitted change to a module every subject crosses would narrow the run to
 * whatever the previous commit touched.
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
    const base = await mergeBase(run, ref, repository);
    return [...(await changedFiles(run, repository, base)), ...(await untrackedFiles(run, repository))].map(
      (file) => relative(here, join(repository, file)),
    );
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
 * Measured from `from` when the caller has one — the commit the execution
 * index was recorded at, which is the only coordinate its line ranges are in.
 * The merge base with `ref` is where the *file list* is measured from, and the
 * two part company the moment `main` moves after the recording: a hunk read at
 * the merge base then lands on lines the journal never numbered. Without a
 * recorded commit the merge base is all there is, and the journal answers over
 * whatever drifted; that is wider than the truth, never narrower, because a line
 * the diff misplaces still lands in the module that was edited.
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
  from?: string,
): Promise<string | undefined> {
  const run = promisify(execFile);
  const here = process.cwd();
  const repository = await topLevel(run, roots[0] === undefined ? here : join(here, roots[0]));

  try {
    const { stdout } = await run('git', [...PLAIN, 'diff', ...NO_DECORATION, '--no-renames', from ?? (await mergeBase(run, ref, repository))], {
      cwd: repository,
      maxBuffer: 64 * 1024 * 1024,
    });
    // An untracked file has no diff of its own: it is shown as the addition it
    // is, so its every line is charged and the graph is asked who imports it.
    const added: string[] = [];
    for (const file of await untrackedFiles(run, repository)) added.push(await diffOfNew(run, repository, file));

    return inCoordinates([stdout, ...added].join('\n'), here, repository);
  } catch {
    return undefined;
  }
}

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

type Run = (file: string, args: readonly string[], options: object) => Promise<{ stdout: string }>;

/**
 * Configuration a diff is read under, whatever the operator's own says.
 *
 * `core.quotePath` writes a path with a byte outside ASCII as a C string, and
 * a reader given `"src/caf\303\251.ts"` matches it against nothing; a prefix
 * other than `a/` and `b/` — `diff.noprefix`, `diff.mnemonicPrefix` — is one
 * the hunk reader does not strip; `diff.external` replaces the output with a
 * tool's. Each turns every changed file into one the selector cannot read,
 * which widens the run and never says why.
 */
const PLAIN = ['-c', 'core.quotePath=false', '-c', 'diff.noprefix=false', '-c', 'diff.mnemonicPrefix=false'];
const NO_DECORATION = ['--no-color', '--no-ext-diff'];

/** Files a diff from `base` to the working tree names, one per record. */
async function changedFiles(run: Run, repository: string, base: string): Promise<readonly string[]> {
  const { stdout } = await run('git', [...PLAIN, 'diff', '--name-only', '-z', base], {
    cwd: repository,
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout.split('\0').filter((file) => file !== '');
}

/**
 * Files the working tree holds and no commit does. A diff never lists them,
 * and "uncommitted edits included" is a lie without them: the new module and
 * the edit that imports it arrive together, and only the edit would show.
 */
async function untrackedFiles(run: Run, repository: string): Promise<readonly string[]> {
  const { stdout } = await run('git', [...PLAIN, 'ls-files', '--others', '--exclude-standard', '-z'], {
    cwd: repository,
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout.split('\0').filter((file) => file !== '');
}

/** The whole of a new file as one hunk of additions. `--no-index` exits 1 when the sides differ, which they do. */
async function diffOfNew(run: Run, repository: string, file: string): Promise<string> {
  try {
    const { stdout } = await run('git', [...PLAIN, 'diff', '--no-index', ...NO_DECORATION, '--', '/dev/null', file], {
      cwd: repository,
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    const failed = error as { readonly code?: unknown; readonly stdout?: unknown };
    if (failed.code === 1 && typeof failed.stdout === 'string') return failed.stdout;
    throw error;
  }
}


/**
 * Where `ref` and `HEAD` part: the commit a two-dot diff from it measures the
 * same distance as `ref...HEAD`, with the working tree included.
 */
async function mergeBase(run: Run, ref: string, repository: string): Promise<string> {
  const { stdout } = await run('git', ['merge-base', ref, 'HEAD'], { cwd: repository });
  return stdout.trim();
}

/**
 * Rewrite the header lines a hunk reader looks at, and leave the rest alone.
 *
 * `diff --git a/X b/Y` is one of them: it is the line a file with no hunk —
 * a binary, a mode change — is named by, and the reader charges that file
 * whole under whatever name the line carries. A rename is shown as the removal
 * and the addition it is, so the removed name is charged whole under the rows
 * the index has for it and the added one is asked of the graph. A path with a
 * space or a
 * character outside ASCII arrives quoted, and a quoted path is passed through
 * untouched for the reader to decode; it is repository-relative then, which is
 * the run's coordinate only when the run is at the top level.
 */
function inCoordinates(diff: string, here: string, repository: string): string {
  const move = (path: string): string => relative(here, join(repository, path));
  return diff
    .split('\n')
    .map((line) => {
      if (line.startsWith('diff --git a/')) {
        const rest = line.slice('diff --git a/'.length);
        // Equal halves first: `a/x b/x` is the common case, and a path that
        // itself contains ` b/` is told apart by that.
        const halves = rest.split(' b/');
        const left = halves.slice(0, halves.length / 2).join(' b/');
        const right = halves.slice(halves.length / 2).join(' b/');
        if (halves.length % 2 === 0 && left === right) return `diff --git a/${move(left)} b/${move(right)}`;
        const at = rest.indexOf(' b/');
        if (at === -1) return line;
        return `diff --git a/${move(rest.slice(0, at))} b/${move(rest.slice(at + 3))}`;
      }
      for (const mark of ['--- a/', '+++ b/']) {
        if (!line.startsWith(mark)) continue;
        const path = line.slice(mark.length);
        return `${mark}${move(path)}`;
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
 * The diff is from the commit itself, with no merge base to find: the index
 * names the exact commit it was written at, and the question is what has moved
 * since, uncommitted edits included. Untracked files are not counted here: the
 * count is a distance, and a new file is at no distance from any commit.
 */
export async function indexPosition(
  root: string,
  roots: readonly string[] = [],
): Promise<{ readonly commit: string; readonly changed: number } | undefined> {
  const run = promisify(execFile);
  const selection = await import('@variance-authority/sense/test-selection');

  try {
    const repository = await topLevel(run, roots[0] === undefined ? root : join(root, roots[0]));
    // The position, and nothing else decoded to reach it: a snapshot of a
    // repository holds hundreds of thousands of regions and this asks it for
    // forty characters.
    const commit = await selection.recordedCommit(selection.testCoverageFile(repository));
    if (commit === undefined) return undefined;
    const changed = (await changedFiles(run, repository, commit)).length;
    return { commit, changed };
  } catch {
    return undefined;
  }
}


/**
 * Where a diff against `ref` is measured from, for a reader that needs a file's
 * **contents** at that point rather than its name.
 *
 * The same two coordinates `changedSince` resolves — the checkout, and the merge
 * base — handed out so that the install can be read at both revisions without a
 * second opinion about which commit *before* means. A run whose file list was
 * measured from one commit and whose lockfile was read at another would report
 * package bumps nobody made, every time `main` moved.
 *
 * `undefined` rather than a throw. The file list is resolved first and has
 * already refused with a sentence naming the ref the operator typed.
 */
export async function diffPoint(
  ref: string,
  roots: readonly string[] = [],
): Promise<DiffPoint | undefined> {
  const run = promisify(execFile);
  const here = process.cwd();

  try {
    const repository = await topLevel(run, roots[0] === undefined ? here : join(here, roots[0]));
    const base = await mergeBase(run, ref, repository);
    return { repository, base, at: (path) => fileAt(repository, base, path) };
  } catch {
    return undefined;
  }
}

/**
 * One file's contents at a revision, or `undefined` when that revision has no
 * such file.
 *
 * The two are told apart by the caller and mean different things: a lockfile
 * that was not there before is an install this cannot compare, and one that is
 * there at both ends is one it can.
 */
async function fileAt(
  repository: string,
  revision: string,
  path: string,
): Promise<string | undefined> {
  const run = promisify(execFile);

  try {
    const { stdout } = await run('git', [...PLAIN, 'show', `${revision}:${path}`], {
      cwd: repository,
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
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
 * is there. Its commit is also where the journal's diff is measured from, since
 * the journal's line ranges are in that commit's coordinates and nothing else's;
 * beyond that it is carried and never acted on. Narrowing is the operator's
 * decision and stays one.
 */
export async function narrowingFor(
  request: NarrowingRequest,
  dirs: readonly string[],
): Promise<{
  readonly since?: {
    readonly ref: string;
    readonly changed: readonly string[];
    readonly install?: InstallDiff;
    readonly diff?: string;
  };
  readonly against?: {
    readonly ref: string;
    readonly changed: readonly string[];
    readonly install?: InstallDiff;
  };
  readonly index?: { readonly commit: string; readonly changed: number };
}> {
  const index = await indexPosition(process.cwd(), dirs);
  const diff =
    request.since === undefined ? undefined : await diffSince(request.since, dirs, index?.commit);
  // The install is read at the same point the file list is measured from. A
  // diff of files against the merge base beside a diff of packages against
  // anything else would report bumps nobody made every time `main` moved.
  const changed = request.since === undefined ? undefined : await changedSince(request.since, dirs);
  const installed =
    request.since === undefined || changed === undefined
      ? undefined
      : await installDiff(await diffPoint(request.since, dirs), changed);
  const since =
    request.since === undefined || changed === undefined
      ? undefined
      : {
          ref: request.since,
          changed,
          ...(installed === undefined ? {} : { install: installed }),
          ...(diff === undefined ? {} : { diff }),
        };
  const againstRef = request.against ?? (request.relations ? request.since : undefined);
  const against =
    againstRef === undefined
      ? undefined
      : againstRef === since?.ref
        ? { ref: againstRef, changed: since.changed, ...(installed === undefined ? {} : { install: installed }) }
        : await (async () => {
            const changed = await changedSince(againstRef, dirs);
            // A second ref is a second install. Explaining a run by one diff's
            // packages while narrowing it by another's would put a bump in the
            // report that no selected subject was selected for.
            const read = await installDiff(await diffPoint(againstRef, dirs), changed);
            return { ref: againstRef, changed, ...(read === undefined ? {} : { install: read }) };
          })();

  return {
    ...(since === undefined ? {} : { since }),
    ...(against === undefined ? {} : { against }),
    ...(index === undefined ? {} : { index }),
  };
}
