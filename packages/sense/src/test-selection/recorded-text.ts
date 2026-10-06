/**
 * The text a snapshot's line numbers are coordinates in.
 *
 * A snapshot's block line ranges are cut from the text on disk at the moment the
 * suite ran, and the snapshot as a whole is labelled with `git rev-parse HEAD`.
 * Those two agree only when the tree was clean, and a snapshot is *recorded by
 * being run*: in the loop this is most wanted in — a developer's, an agent's —
 * the tree is never clean, so the ranges are the working tree's and the label
 * says the commit's. Every hunk a later diff produces is then charged to
 * whatever region happens to occupy those numbers now, which is a different
 * region, belonging to different tests, or to none.
 *
 * So the selector asks, per changed module, for the text at the position the
 * snapshot names, and hashes it against the digest the recorder already wrote.
 *
 * ## Why this is an implementation and not the behaviour
 *
 * `sourceAt` stays an option the caller passes rather than something
 * `narrowByExecution` does by itself, because where a repository keeps its
 * history is not a library's fact to assume: a worktree, a shallow clone, a
 * bare mirror and a sandbox with no `git` at all each answer differently, and a
 * library that guessed would be trusted for an answer nobody checked.
 *
 * Shipping no implementation is the other error, and it is the one that was
 * made here. The check is opt-in, so a caller that does not know to wire it
 * gets `stale` empty — not because the frames agree but because nothing looked,
 * which reads identically and is the failure the option exists to prevent. This
 * is the answer for the ordinary case, a git checkout, and it is the read-side
 * counterpart of `commitOf`: that one writes the position, this one reads from
 * it.
 *
 * ## Why a window rather than a process a file or a buffer a diff
 *
 * A selection is asked about every file in a diff, and a merge or a rebase names
 * thousands. At a process apiece that is minutes, so the paths go to one
 * `git cat-file --batch` together.
 *
 * Together is not the same as all at once. A batch over the whole diff holds
 * every file's text twice — the buffer git wrote and the strings read out of it,
 * both alive until the last path is answered — and at fifteen thousand changed
 * files that is the largest thing in the process by a wide margin, for texts each
 * of which is wanted once, hashed, and never looked at again. So the fetch runs
 * over a window: one process for a slab of the diff, released whole before the
 * next slab is read. The peak is then the window rather than the diff, which is
 * the difference between a cost that grows with the change and one that does not.
 *
 * The caller decides which paths are worth a window at all. `files` is the set
 * this expects to be asked about, and it is read in order as the asks arrive, so
 * a caller that hands over only the paths it has a digest to compare against
 * never pays for the rest of the diff.
 *
 * ## A path from outside the set
 *
 * A path arriving from outside that set is still answered, and the window
 * stays where it is: the selector asks about a changed file's importers between
 * two changed files, and a window dropped for each of them would leave every
 * changed file after it to be read alone.
 *
 * Those paths are mostly files the change did not touch, and a reading that
 * follows a changed export asks about every importer of it, a few hundred for a
 * shared module. At a process apiece that is seconds. So from the second such
 * path at a commit, the commit's tree is listed once, and a path whose bytes on
 * disk hash to the blob the commit holds there is answered from disk. The hash
 * is git's own object name for those bytes, so the answer is the commit's text
 * whatever happened on disk since; a path the hash does not match, or the
 * listing does not hold, is read from git alone, as before.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { native } from '../addon.js';

/**
 * How much text one window may hold, and how many paths the first one guesses at.
 *
 * A window trades a process against resident text, and only the second is
 * bounded here: the count is revised after every window from the sizes that
 * window actually returned, so a tree of ordinary source files converges on a
 * few thousand paths a process and one of committed bundles on a handful. The
 * first window is deliberately narrow, because it is the one guessing.
 */
const WINDOW_BYTES = 8 * 1024 * 1024;
const FIRST_WINDOW = 64;
const WIDEST_WINDOW = 4096;

/** Where `file` sits in a code-unit-sorted list, or -1. */
function positionOf(sorted: readonly string[], file: string): number {
  let low = 0;
  let high = sorted.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const at = sorted[mid] as string;
    if (at === file) return mid;
    if (at < file) low = mid + 1;
    else high = mid - 1;
  }
  return -1;
}

/**
 * A `sourceAt` for this repository, reading a path at whatever position the
 * snapshot turns out to have been recorded at.
 *
 * Pass it the paths the selector will ask about — `changedLines(diff).keys()`,
 * so the two parses of the diff cannot disagree at the edges, or the narrower
 * set a caller that already knows which paths it holds a digest for can name.
 * Hand the result to `narrowByExecution` as `sourceAt`.
 *
 * `undefined` for a path the position does not hold is the answer the selector
 * wants: a snapshot with a row for a file that did not exist at its own commit
 * is describing a text nobody here has, which is the same disagreement as a
 * digest that differs.
 */
export function textAtRecording(
  root: string,
  files: Iterable<string>,
): (file: string, commit: string | undefined) => string | undefined {
  const expected = [...new Set(files)].sort();
  let at: string | undefined;
  // How far through `expected` the windows have read, and how wide the next one
  // is: both are positions in this one commit's reading and reset with it.
  let read = 0;
  let width = FIRST_WINDOW;
  let held = new Map<string, string>();
  let asked = new Set<string>();
  // How many paths from outside the window this commit was asked about, and its
  // tree once the second arrived: `null` when git could not list it.
  let outside = 0;
  let listing: Listing | null | undefined;

  return (file, commit) => {
    // No position to read from. A snapshot recorded outside a checkout cannot be
    // checked this way, and reporting every module stale would widen every run
    // to the whole suite for a fact nobody established.
    if (commit === undefined) return undefined;

    if (at !== commit) {
      at = commit;
      read = 0;
      width = FIRST_WINDOW;
      held = new Map();
      asked = new Set();
      outside = 0;
      listing = undefined;
    }
    // Asked about, and answered — including answered *missing*, which is a fact
    // about the commit and not a reason to ask again.
    if (asked.has(file)) return held.get(file);

    const from = positionOf(expected, file);
    // A path the caller never named, or one the window has already rolled past,
    // is read on its own. Sliding backwards would re-read every path between,
    // and the callers this serves ask in the diff's order.
    if (from < read) {
      outside += 1;
      if (outside > 1) listing ??= listed(root, commit);
      return (listing ? unchangedOnDisk(root, listing, file) : undefined) ?? batch(root, commit, [file]).get(file);
    }
    const window = expected.slice(from, from + width);
    read = from + width;

    // The previous window goes before the next one arrives, so no two are ever
    // resident together.
    held = new Map();
    asked = new Set(window);
    held = batch(root, commit, window);

    let bytes = 0;
    for (const text of held.values()) bytes += text.length;
    width = Math.min(
      WIDEST_WINDOW,
      Math.max(1, Math.round((WINDOW_BYTES * window.length) / Math.max(bytes, 1))),
    );

    return held.get(file);
  };
}

/**
 * One window of paths at one commit, from one process — and in a partial
 * clone, a second for the paths it had not fetched yet, after fetching all of
 * them in one request.
 *
 * `cat-file --batch` fetches each object a partial clone lacks in a request of
 * its own, a network round trip per path. So with the addon at hand the first
 * read does not fetch, and the addon fetches what it answered missing
 * together, as `promisor.rs` describes. A path still missing after that is one
 * the commit does not hold. Without the addon the read fetches as git does by
 * default: slower in a partial clone, and the same answers.
 */
function batch(root: string, commit: string, files: readonly string[]): Map<string, string> {
  const fetchMissingAt = native()?.fetchMissingAt;
  const { texts, missing } = read(root, commit, files, fetchMissingAt === undefined);
  if (missing.length > 0 && fetchMissingAt?.(root, commit, missing) === true) {
    for (const [file, text] of read(root, commit, missing, true).texts) texts.set(file, text);
  }
  return texts;
}

/**
 * `files` at `commit` from one `cat-file --batch`, with the paths it answered
 * missing. Without `fetch`, an object a partial clone has not fetched is
 * answered missing too.
 *
 * `--batch` writes `<sha> <type> <size>\n<size bytes>\n` per found object and
 * `<spec> missing\n` per absent one, so the sizes are read rather than the
 * newlines guessed at — a source file holding the word `missing` on a line of
 * its own would otherwise end the object early.
 */
function read(
  root: string,
  commit: string,
  files: readonly string[],
  fetch: boolean,
): { texts: Map<string, string>; missing: string[] } {
  const texts = new Map<string, string>();
  const missing: string[] = [];
  if (files.length === 0) return { texts, missing };

  let output: Buffer;
  try {
    output = execFileSync('git', ['cat-file', '--batch'], {
      cwd: root,
      input: files.map((file) => `${commit}:${file}\n`).join(''),
      maxBuffer: 1 << 30,
      ...(fetch ? {} : { env: { ...process.env, GIT_NO_LAZY_FETCH: '1' } }),
    });
  } catch {
    // Git before 2.44 does not answer `missing` for an object lazy fetching
    // would have fetched: it stops at the first one, fatally. So a read that
    // did not fetch answers every path missing, and the caller fetches them
    // together. Otherwise this is not a checkout, no such commit, or no git;
    // every module then reads as unverified, which widens rather than narrows,
    // and is the direction this whole subsystem is allowed to fail in.
    return { texts, missing: fetch ? missing : [...files] };
  }

  let at = 0;
  for (const file of files) {
    const newline = output.indexOf(0x0a, at);
    if (newline === -1) break;
    const header = output.toString('utf8', at, newline);
    at = newline + 1;
    // `<spec> missing` carries no size and no body, so the next header starts
    // where this line ended.
    const size = Number(header.slice(header.lastIndexOf(' ') + 1));
    if (!Number.isFinite(size)) {
      if (header.endsWith(' missing')) missing.push(file);
      continue;
    }
    // Advance past the body whatever its type, so one path that is somehow not a
    // blob costs its own answer and not every answer after it.
    if (header.endsWith(` blob ${size}`)) texts.set(file, output.toString('utf8', at, at + size));
    // The object, then the newline `--batch` writes after it.
    at += size + 1;
  }

  return { texts, missing };
}

/**
 * A commit's tree as `ls-tree -r -z --full-tree` wrote it, with where each
 * entry starts. Git writes the entries in the byte order of the full path, so
 * a path is found by bisecting the bytes rather than by a map of every path in
 * the repository.
 */
interface Listing {
  readonly bytes: Buffer;
  readonly starts: Uint32Array;
}

function listed(root: string, commit: string): Listing | null {
  let bytes: Buffer;
  try {
    bytes = execFileSync('git', ['ls-tree', '-r', '-z', '--full-tree', commit], {
      cwd: root,
      maxBuffer: 1 << 30,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
  const starts: number[] = [];
  for (let at = 0; at < bytes.length; ) {
    const end = bytes.indexOf(0, at);
    if (end === -1) break;
    starts.push(at);
    at = end + 1;
  }
  return { bytes, starts: Uint32Array.from(starts) };
}

/**
 * The text on disk at `file`, when its bytes are the blob the listed commit
 * holds there. `undefined` otherwise, for the caller to ask git: a path the
 * listing does not hold, one that is not a regular file there, or one whose
 * bytes on disk moved or are gone.
 */
function unchangedOnDisk(root: string, listing: Listing, file: string): string | undefined {
  const { bytes, starts } = listing;
  const target = Buffer.from(file, 'utf8');
  let low = 0;
  let high = starts.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const start = starts[mid]!;
    const tab = bytes.indexOf(0x09, start);
    const order = bytes.compare(target, 0, target.length, tab + 1, bytes.indexOf(0, tab));
    if (order < 0) low = mid + 1;
    else if (order > 0) high = mid - 1;
    else {
      // `<mode> <type> <object>`: a symbolic link's blob is its target, not what reading it gives.
      const [mode, type, object] = bytes.toString('latin1', start, tab).split(' ');
      if (type !== 'blob' || (mode !== '100644' && mode !== '100755') || object === undefined) return undefined;
      let text: Buffer;
      try {
        text = readFileSync(join(root, file));
      } catch {
        return undefined;
      }
      return blobName(text, object.length) === object ? text.toString('utf8') : undefined;
    }
  }
  return undefined;
}

/** Git's name for `bytes` as a blob, in the repository's hash: a SHA-256 name is 64 digits. */
function blobName(bytes: Buffer, digits: number): string {
  return createHash(digits === 64 ? 'sha256' : 'sha1')
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest('hex');
}
