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
 * never pays for the rest of the diff. A path arriving from outside that set is
 * still answered, on its own.
 */

import { execFileSync } from 'node:child_process';
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
  // Which paths this commit's reading has answered, and how wide the next window
  // is: both reset with the commit.
  let answered = new Set<string>();
  let width = FIRST_WINDOW;
  let held = new Map<string, string>();
  let asked = new Set<string>();

  return (file, commit) => {
    // No position to read from. A snapshot recorded outside a checkout cannot be
    // checked this way, and reporting every module stale would widen every run
    // to the whole suite for a fact nobody established.
    if (commit === undefined) return undefined;

    if (at !== commit) {
      at = commit;
      answered = new Set();
      width = FIRST_WINDOW;
      held = new Map();
      asked = new Set();
    }
    // Asked about, and answered — including answered *missing*, which is a fact
    // about the commit and not a reason to ask again.
    if (asked.has(file)) {
      answered.add(file);
      return held.get(file);
    }

    // A path the caller never named, or one asked again after its window went, is
    // read on its own. Any other path opens a window over it and the paths after
    // it not yet answered: the selector asks a few paths ahead of the rest, so a
    // window can go before the paths it read are asked, and those paths are then
    // read again together rather than a process apiece.
    const from = answered.has(file) ? -1 : positionOf(expected, file);
    answered.add(file);
    const window = from === -1 ? [file] : unanswered(expected, from, width, answered);

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

/** `expected[from]`, then up to `width` in all of the paths after it that `answered` does not hold. */
function unanswered(expected: readonly string[], from: number, width: number, answered: ReadonlySet<string>): string[] {
  const window = [expected[from] as string];
  for (let at = from + 1; at < expected.length && window.length < width; at += 1) {
    const file = expected[at] as string;
    if (!answered.has(file)) window.push(file);
  }
  return window;
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
