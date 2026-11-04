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
 * Shipping no implementation is the other error: the check is opt-in, so a
 * caller that does not know to wire it gets `stale` empty, not because the frames
 * agree but because nothing looked. This is the answer for the ordinary case, a
 * git checkout, the read-side counterpart of `commitOf`.
 *
 * ## Two costs, one bound each
 *
 * A selection asks about every file in a diff, a merge or a rebase names
 * thousands, and it asks in jumps and again and again: a shared module's
 * importers between two changed files, the same four hundred paths a hundred
 * thousand times over. That has two costs, and they are bounded apart.
 *
 * Time is processes. So a text or an absent path comes from one `git cat-file
 * --batch` the addon leaves open, as `commit_text.rs` describes, and asking
 * again costs an inflate and a pipe, in any order. What it cannot answer starts
 * processes at every read, about sixteen for a git-LFS pointer's content.
 *
 * Memory is text held. So a reader holds what was asked most recently, a path
 * the commit does not hold included, up to `HELD_BYTES`: a change of fifteen
 * thousand files at two hundred kilobytes is three gigabytes of history, and
 * each text is wanted for a moment. Nothing is held that nobody asked for.
 *
 * ## What reaches git
 *
 * While everything asked of a reader fits `HELD_BYTES`, a path at a commit
 * reaches git once. Past it, a path at a commit reaches git again when more than
 * `HELD_BYTES` of other answers were asked since it was last asked: no bound
 * promises once, because the next ask may always be for what was let go of. A text
 * larger than `HELD_BYTES` reaches git at every ask, and lets go of nothing. A
 * read git refused holds nothing, and starts its processes and throws again.
 *
 * ## What `files` is for
 *
 * The caller names the paths it expects to ask about, and may ask about any
 * other. The list is what a partial clone fetches in one request before the
 * first read at a commit, since git asked for a blob the clone lacks makes a
 * request apiece. The selector names, with every ask, the paths it will read a
 * text under, and that list replaces `files`, so the changed files no test ran,
 * which nothing asks about, are never fetched.
 */

import { native, nativeRefusal } from '../addon.js';
import type { NativeTextColumns } from '../native-commit-text.js';

/**
 * How much text a reader holds, in the bytes this process spends on it. It
 * bounds that text and nothing else: holding 8 MB adds about 180 MB to the peak
 * of a read of fifteen thousand files, and the open process's memory is git's.
 *
 * Holding a text saves an inflate and a pipe, under half a millisecond for
 * 210 KB. Holding a git-LFS pointer's content saves its processes, about 70 ms.
 * The four hundred paths one selection asked a hundred thousand times over are
 * about 4 MB of source, so 8 MB holds them. A wider selection outgrows it and
 * reads some again, a pipe each. 128 MB adds about 690 MB to that peak, for
 * text that saves no process.
 */
export const HELD_BYTES = 8 * 1024 * 1024;

/**
 * What an entry costs beside its key's characters and its text, so a path the
 * commit does not hold is not free: 96 bytes of `Map` node and record measured
 * over 200,000 entries, and the table's growth above it.
 */
const ENTRY_BYTES = 128;

/** What a reader keeps of one answer, `undefined` a path the commit does not hold. */
interface Held {
  readonly text: string | undefined;
  readonly bytes: number;
}

/** The bytes the process spends on `text`: one a character, or two once any is not ASCII, which over-charges Latin-1. */
function bytesOf(text: string | undefined): number {
  if (text === undefined) return 0;
  return Buffer.byteLength(text) === text.length ? text.length : 2 * text.length;
}

/**
 * A `sourceAt` for this repository, reading a path at whatever position the
 * snapshot turns out to have been recorded at.
 *
 * Pass it the paths the selector will ask about — `changedLines(diff).keys()`,
 * so the two parses of the diff cannot disagree at the edges, or the narrower
 * set a caller that already knows which paths it holds a digest for can name.
 * Hand the result to `narrowByExecution` as `sourceAt`, which narrows the set
 * further with `asking`: the paths it reads a text under.
 *
 * `undefined` for a path the position does not hold is the answer the selector
 * wants: a snapshot with a row for a file that did not exist at its own commit
 * is describing a text nobody here has, which is the same disagreement as a
 * digest that differs.
 */
export function textAtRecording(
  root: string,
  files: Iterable<string>,
): (file: string, commit: string | undefined, asking?: readonly string[]) => string | undefined {
  let expected = [...new Set(files)];
  // The list the selector named with its asks, once one has arrived: it
  // replaces `files`, because it is the part of them the selector reads.
  let named: readonly string[] | undefined;
  // The commits `expected` was fetched at.
  const fetched = new Set<string>();
  // In the order asked, the most recent last. The commit is in the key, so a
  // turn between commits lets go of nothing.
  const held = new Map<string, Held>();
  let holding = 0;

  return (file, commit, asking) => {
    if (asking !== undefined && asking !== named) {
      named = asking;
      expected = [...new Set(asking)];
      fetched.clear();
    }
    // No position to read from. A snapshot recorded outside a checkout cannot be
    // checked this way, and reporting every module stale would widen every run
    // to the whole suite for a fact nobody established.
    if (commit === undefined) return undefined;

    const key = `${commit}\0${file}`;
    const known = held.get(key);
    if (known !== undefined) {
      held.delete(key);
      held.set(key, known);
      return known.text;
    }

    const addon = native();
    if (addon?.textAt === undefined || addon.fetchTextsAt === undefined) throw unread();
    if (!fetched.has(commit)) {
      fetched.add(commit);
      if (expected.length > 0) addon.fetchTextsAt(root, commit, expected);
    }
    // A refused read throws here, so it is never held as the path being absent.
    const text = addon.textAt(root, commit, file) ?? undefined;

    const bytes = ENTRY_BYTES + key.length + bytesOf(text);
    if (bytes > HELD_BYTES) return text;
    held.set(key, { text, bytes });
    holding += bytes;
    for (const [oldest, { bytes: released }] of held) {
      if (holding <= HELD_BYTES) break;
      held.delete(oldest);
      holding -= released;
    }
    return text;
  };
}

/**
 * Paths at several commits, read as {@link readTextsAt} reads them, by commit
 * and then path, leaving out a path the commit does not hold.
 *
 * For a reader that wants a few paths at each of a few commits at once — the
 * manifests and the lockfile where each group of tests last ran.
 */
export function textsAt(root: string, asked: ReadonlyMap<string, Iterable<string>>): Map<string, Map<string, string>> {
  return answered(readTextsAt(root, asked));
}

/** The texts {@link readTextsAt} read, and why git could not give the others, each by commit and then path. */
interface CommitTexts {
  readonly texts: Map<string, Map<string, string>>;
  readonly refused: Map<string, Map<string, string>>;
}

/**
 * Paths at each commit, read by the addon, by commit and then
 * path, leaving out a path the commit does not hold, and naming git's reason
 * for each one it could not read: a commit or a blob this clone lacks, or a
 * git-LFS pointer with no content here. For a reader that names the gap and
 * answers the rest, where {@link textsAt} fails on the first. The addon reads
 * them, as `commit_text.rs` describes: in a partial clone it fetches the blobs
 * a read names together first, and it gives a git-LFS pointer as its content.
 */
export function readTextsAt(root: string, asked: ReadonlyMap<string, Iterable<string>>): CommitTexts {
  return columns(root, asked, native()?.textsAt);
}

/**
 * The git blob name, `git:<object>`, of paths at several commits, by commit
 * and then path, leaving out a path the commit does not hold, and naming git's
 * reason for each commit it could not list: {@link readTextsAt}'s read without
 * the bodies, so a reader that only asks whether two commits hold the same text
 * reads none. The name is git's, in the repository's own hash.
 */
export function readBlobsAt(root: string, asked: ReadonlyMap<string, Iterable<string>>): CommitTexts {
  return columns(root, asked, native()?.blobsAt);
}

/** {@link readBlobsAt}'s names, failing on the first path git could not list. */
export function blobsAt(root: string, asked: ReadonlyMap<string, Iterable<string>>): Map<string, Map<string, string>> {
  return answered(readBlobsAt(root, asked));
}

type Columns = (root: string, commits: string[], paths: string[][]) => NativeTextColumns;

function unread(): Error {
  return new Error(`the text at a recording is read by the native addon, which ${nativeRefusal() || 'is older than this package'}`);
}

/** `asked` read by the addon's `read`, from its columns into maps by commit and then path. */
function columns(root: string, asked: ReadonlyMap<string, Iterable<string>>, read: Columns | undefined): CommitTexts {
  if (read === undefined) throw unread();
  const commits = [...asked.keys()];
  const texts = new Map(commits.map((commit) => [commit, new Map<string, string>()]));
  const refused = new Map<string, Map<string, string>>();
  if (commits.length === 0) return { texts, refused };
  const found = read(root, commits, [...asked.values()].map((files) => [...new Set(files)]));
  for (let at = 0; at < found.file.length; at += 1) {
    texts.get(commits[found.commit[at]!]!)!.set(found.file[at]!, found.text[at]!);
  }
  for (let at = 0; at < found.refusedFile.length; at += 1) {
    const commit = commits[found.refusedCommit[at]!]!;
    refused.set(commit, (refused.get(commit) ?? new Map()).set(found.refusedFile[at]!, found.refused[at]!));
  }
  return { texts, refused };
}

/** The texts or names read, failing on the first path git could not read. */
function answered({ texts, refused }: CommitTexts): Map<string, Map<string, string>> {
  for (const why of refused.values()) for (const reason of why.values()) throw new Error(reason);
  return texts;
}
