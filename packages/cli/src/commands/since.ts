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
import { realpathSync } from 'node:fs';
import { promisify } from 'node:util';
import { join, relative } from 'node:path';
import { OperatorError } from '../exit.js';
import type { DiffPoint } from './installed.js';
import type { MovedExports } from './reach.js';
import { suiteRecord } from './suite-record.js';

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
export async function changedSince(ref: string, roots: readonly string[] = []): Promise<readonly string[]> {
  const run = promisify(execFile);
  const here = process.cwd();

  try {
    const asked = roots[0] === undefined ? here : join(here, roots[0]);
    const repository = await topLevel(asked, run);
    if (repository === undefined) throw new Error(`${asked} is not in a git checkout`);
    const base = await mergeBase(run, ref, repository);
    return [...(await changedFiles(run, repository, base)), ...(await untrackedFiles(run, repository))].map(
      (file) => relative(here, join(repository, file)),
    );
  } catch (error) {
    throw new OperatorError(
      `\`--since ${ref}\` could not list what changed: ${messageOf(error)}. ` +
        'A run that answered this with an empty diff would narrow itself to nothing and report ' +
        'success, so it refuses instead. Check the ref exists and that this is a git checkout ' +
        '(a shallow CI clone needs every commit: `fetch-depth: 0` with `filter: tree:0`).',
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
 * `reverse` reads the same change from the working tree back to `from`, so its
 * old side is the working tree. A record written *after* the change ran is in
 * those coordinates, and a hunk read the forward way would land on the lines
 * the base numbered. Git writes the reversed prefixes the other way round;
 * they are named so every reader of a diff here still sees `a/` over `b/`.
 *
 * `undefined` rather than a throw. A repository that cannot produce a diff has
 * already refused the file list a moment earlier with a sentence naming the ref;
 * failing twice for one cause would replace that sentence with this one. And the
 * journal only ever *removes* subjects, so its absence is a wider run, never a
 * quieter one. `unified` is the context written around each hunk; `0` gives the
 * line map the hunk headers alone carry.
 */
export async function diffSince(
  ref: string,
  roots: readonly string[] = [],
  from?: string,
  options: { readonly reverse?: boolean; readonly cwd?: string; readonly unified?: number } = {},
): Promise<string | undefined> {
  const run = promisify(execFile);
  const here = options.cwd ?? process.cwd();
  const repository = await topLevel(roots[0] === undefined ? here : join(here, roots[0]), run);
  if (repository === undefined) return undefined;
  const side = [...(options.reverse === true ? REVERSED : []), ...(options.unified === undefined ? [] : [`-U${options.unified}`])];

  try {
    // FIXME: a changed submodule is one `Subproject commit` hunk under its gitlink
    // path, so no test under it, or that entered a file inside it, is charged.
    const { stdout } = await run('git', [...PLAIN, 'diff', ...NO_DECORATION, ...side, '--no-renames', from ?? (await mergeBase(run, ref, repository))], {
      cwd: repository,
      maxBuffer: 64 * 1024 * 1024,
    });
    // An untracked file has no diff of its own: it is shown as the addition it
    // is, so its every line is charged and the graph is asked who imports it.
    const added: string[] = [];
    for (const file of await untrackedFiles(run, repository)) added.push(await diffOfNew(run, repository, file, side));

    return inCoordinates([stdout, ...added].join('\n'), here, repository);
  } catch {
    return undefined;
  }
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
const REVERSED = ['-R', '--src-prefix=b/', '--dst-prefix=a/'];

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
async function diffOfNew(run: Run, repository: string, file: string, side: readonly string[]): Promise<string> {
  try {
    const { stdout } = await run('git', [...PLAIN, 'diff', '--no-index', ...NO_DECORATION, ...side, '--', '/dev/null', file], {
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
 *
 * `here` is read with its links resolved, because git spells the top level that
 * way: a run started under a link — every temporary directory on macOS, through
 * `/var` — would otherwise name each file by climbing out of the link and back.
 * Git has just run in or under `here`, so it resolves; were it removed since, the throw
 * is the caller's no-diff answer.
 */
function inCoordinates(diff: string, here: string, repository: string): string {
  const from = realpathSync(here);
  const move = (path: string): string => relative(from, join(repository, path));
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
  suite?: string,
): Promise<{ readonly commit: string; readonly changed: number } | undefined> {
  const run = promisify(execFile);
  const selection = await import('@variance-authority/sense/test-selection');

  try {
    const repository = await topLevel(roots[0] === undefined ? root : join(root, roots[0]), run);
    if (repository === undefined) return undefined;
    // The position, and nothing else decoded to reach it: a snapshot of a
    // repository holds hundreds of thousands of regions and this asks it for
    // forty characters.
    const commit = await selection.recordedCommit(await suiteRecord(repository, suite));
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
export async function diffPoint(ref: string, roots: readonly string[] = [], here = process.cwd()): Promise<DiffPoint | undefined> {
  return await pointAt(roots, (run, repository) => mergeBase(run, ref, repository), here);
}

/**
 * The point at `commit` itself, with no merge base taken — for a record that
 * says a test ran *at* that commit, whatever line it is on. A test that last
 * ran on another branch ran against that branch's install, and the merge base
 * with this one is an install it never saw. `undefined` when git cannot
 * resolve the commit here.
 */
export async function commitPoint(commit: string, roots: readonly string[] = [], here = process.cwd()): Promise<DiffPoint | undefined> {
  return await pointAt(roots, async (run, repository) => {
    const { stdout } = await run('git', ['rev-parse', '--verify', '--quiet', `${commit}^{commit}`], { cwd: repository });
    return stdout.trim();
  }, here);
}

/** The point `baseOf` names in the checkout `here` (or `roots[0]` under it) belongs to. */
async function pointAt(roots: readonly string[], baseOf: (run: Run, at: string) => Promise<string>, here: string): Promise<DiffPoint | undefined> {
  const run = promisify(execFile);
  try {
    const repository = await topLevel(roots[0] === undefined ? here : join(here, roots[0]), run);
    if (repository === undefined) return undefined;
    const base = await baseOf(run, repository);
    return { repository, base, at: (path) => fileAt(repository, base, path) };
  } catch {
    return undefined;
  }
}

/**
 * What each changed file moved for its importers, in run coordinates.
 *
 * Each is read at the same point the install is, from both texts — git's at
 * the merge base and the disk's now — and the addon's verdict decides. A
 * comment, a type or formatting moves nothing a test executes, so a walk from
 * the file graph seeds none of them; a change to one export seeds only the
 * files that import it.
 *
 * `undefined` is *no reading was taken*: no diff point, or no addon on this
 * machine. Every changed file is then a change, which is the answer the walk
 * gave before it could read one. A file the reading could not name exports for
 * — a path outside the checkout, one added, one whose load moved — is absent
 * from the map, and seeds the walk whole.
 */
export async function movedSince(point: DiffPoint | undefined, changed: readonly string[]): Promise<MovedExports | undefined> {
  if (point === undefined) return undefined;
  const here = process.cwd();
  const named = new Map<string, string>();
  for (const file of changed) {
    const at = relative(point.repository, join(here, file));
    if (!at.startsWith('..')) named.set(at, file);
  }
  const { runsAsBefore } = await import('@variance-authority/sense/test-selection');
  const read = runsAsBefore(point.repository, point.base, [...named.keys()]);
  if ('unread' in read) return undefined;
  return new Map([...read.moved].map(([file, exports]) => [named.get(file)!, exports]));
}

/**
 * One file's contents at a revision, or `undefined` when that revision has no
 * such file.
 *
 * The two are told apart by the caller and mean different things: a lockfile
 * that was not there before is an install this cannot compare, and one that is
 * there at both ends is one it can.
 */
async function fileAt(repository: string, revision: string, path: string): Promise<string | undefined> {
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
 * The top level of the checkout a directory belongs to, as git spells it, or
 * `undefined` when it belongs to none.
 *
 * Never the run's own directory in its place: that is another repository's
 * answer, and a diff read there names changes this directory never made. A
 * caller with no checkout has no diff, which skips nothing; `changedSince`
 * refuses instead, with a sentence naming the ref the operator typed.
 */
export async function topLevel(from: string, run: Run = promisify(execFile)): Promise<string | undefined> {
  try {
    const { stdout } = await run('git', ['rev-parse', '--show-toplevel'], { cwd: from });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
