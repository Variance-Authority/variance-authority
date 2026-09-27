/**
 * A line: the latest of what CI derived on one mainline or one branch.
 *
 * A line answers the question a checkout actually has — *what is mainline now*
 * — by holding one version and replacing it, rather than keeping one artifact
 * per commit for a reader to walk history in search of. Work is branched off a
 * mainline and brought up to date with it before it merges, so the latest is
 * the right answer, and the distance from a checkout to it is the instruction
 * when it is not.
 *
 * A line holds **entries**, each a versioned artifact derived at one commit: the
 * run report, one record per suite, the suite index. They are entries rather
 * than one bundle because they arrive from different jobs, and a publish replaces
 * only what it carries. It also holds the **images** its entries name, by digest,
 * because an image does not compress and costs nothing to keep once.
 *
 * Nothing here collapses a failure into a miss. A reader has to be told whether
 * nothing was published, it lacks the credentials, the store could not be
 * reached, or a newer writer left a format it cannot read, because each of those
 * asks for a different action.
 */

import { sha256HexBytes } from '../format/sha256.js';

/** One line a share holds the latest of. */
export interface ShareLine {
  readonly kind: 'mainline' | 'branch';
  /** The branch name as git spells it, `release/2.0` included. */
  readonly name: string;
}

/** An artifact offered to a line. */
export interface ShareEntry {
  /** `<family>-v<version>`, optionally `/<qualifier>`: `report-v1`, `suite-v1/web`. */
  readonly name: string;
  /** The commit it was derived at. For a pull request, the merge CI ran on. */
  readonly commit: string;
  /** The commit a pull request pointed at, when `commit` is the merge made for it. */
  readonly head?: string;
  /** Digests of the images this entry names, which the line keeps while it keeps the entry. */
  readonly images?: readonly string[];
  readonly bytes: Uint8Array;
}

/** An entry as the line holds it: what it is, where its bytes are, and nothing else. */
export interface HeldEntry {
  readonly name: string;
  readonly commit: string;
  readonly head?: string;
  readonly images?: readonly string[];
  readonly digest: string;
  readonly size: number;
}

/** What a line holds now. */
export interface LineManifest {
  readonly format: 1;
  /** Sorted by name, in code-unit order. */
  readonly entries: readonly HeldEntry[];
}

/**
 * Why a line could not answer.
 *
 * - `absent`: nothing was published under that name.
 * - `newer`: something was, in a format this reader does not know.
 * - `refused`: the store answered, and said no.
 * - `unreachable`: the store did not answer, or not in time.
 * - `unreadable`: the store answered with bytes that are not what they claim.
 */
export type ShareMiss =
  | { readonly kind: 'absent' }
  | { readonly kind: 'newer'; readonly names: readonly string[] }
  | { readonly kind: 'refused'; readonly detail: string }
  | { readonly kind: 'unreachable'; readonly detail: string }
  | { readonly kind: 'unreadable'; readonly detail: string };

/** A path inside a line: an entry's bytes or an image, both by digest. */
export type BlobPath = `entries/${string}` | `images/${string}`;

/**
 * The one thing a backend has to provide: a manifest that is replaced only if
 * nobody replaced it first, and the blobs it names.
 *
 * Deliberately below the rules. What may replace what, which images to send and
 * how a reader tells a newer format from nothing are decided once, in
 * {@link publishLine} and {@link readLine}, so a directory, a bucket and a git
 * ref cannot disagree about them.
 */
export interface LineCell {
  /** The manifest and an opaque version to write against, or why not. */
  load(line: ShareLine): Promise<{ readonly manifest: Uint8Array; readonly version: string } | ShareMiss>;
  blob(line: ShareLine, path: BlobPath): Promise<Uint8Array | ShareMiss>;
  /**
   * Replace the manifest, if the held version is still `expected`.
   *
   * `expected` absent means the line must not exist yet. `blobs` holds only
   * what the held line lacks; every other path the manifest names is already
   * there, and a backend that builds on the held version relies on that.
   */
  store(
    line: ShareLine,
    write: {
      readonly manifest: Uint8Array;
      readonly blobs: ReadonlyMap<BlobPath, Uint8Array>;
      readonly expected?: string;
    },
  ): Promise<'written' | 'conflict' | ShareMiss>;
}

/** An entry name, read. */
export interface EntryName {
  readonly family: string;
  readonly version: number;
  readonly qualifier?: string;
}

const ENTRY = /^([a-z][a-z0-9-]*)-v([1-9][0-9]*)(?:\/([A-Za-z0-9._-]+))?$/;
const COMMIT = /^[0-9a-f]{4,64}$/;
const DIGEST = /^[0-9a-f]{64}$/;

/** Read an entry name, or refuse it. */
export function parseEntryName(name: string): EntryName | undefined {
  const match = ENTRY.exec(name);
  if (match === null) return undefined;
  const qualifier = match[3];
  return {
    family: match[1]!,
    version: Number(match[2]),
    ...(qualifier !== undefined && qualifier !== '.' && qualifier !== '..' ? { qualifier } : {}),
  };
}

/** Two entries are the same slot when they differ at most in version. */
export function sameSlot(a: EntryName, b: EntryName): boolean {
  return a.family === b.family && a.qualifier === b.qualifier;
}

/**
 * The path of a line inside a store, `mainline/release/2.0`.
 *
 * Each segment of the branch name is folded to key characters, a
 * deliberately many-to-one mapping. Two branches whose names differ only in
 * folded characters share a line, and a reader tells them apart by whether its
 * `HEAD` contains the commit the line names.
 */
export function linePath(line: ShareLine): string {
  const segments = line.name
    .split('/')
    .map((part) => part.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, ''))
    .filter((part) => part !== '');
  return `${line.kind}/${segments.length === 0 ? 'unnamed' : segments.join('/')}`;
}

/** The digest an entry's bytes are held under. */
export function entryDigest(bytes: Uint8Array): string {
  return sha256HexBytes(bytes);
}

/**
 * The manifest as bytes: canonical, ASCII, byte-stable.
 *
 * Every field is checked to be ASCII before it is written — names, commits and
 * digests already are — so no text encoder is needed and two runtimes cannot
 * write two spellings of one manifest.
 */
export function encodeManifest(manifest: LineManifest): Uint8Array {
  const entries = [...manifest.entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const text = JSON.stringify({
    format: manifest.format,
    entries: entries.map((entry) => ({
      name: entry.name,
      commit: entry.commit,
      ...(entry.head !== undefined ? { head: entry.head } : {}),
      ...(entry.images !== undefined ? { images: [...entry.images].sort() } : {}),
      digest: entry.digest,
      size: entry.size,
    })),
  });
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code > 0x7e) throw new Error(`a manifest holds ASCII only, and this one does not at ${String(i)}`);
    bytes[i] = code;
  }
  return bytes;
}

/**
 * Read a manifest, or say why it is not one.
 *
 * A `format` above 1 is a newer writer, not a broken one, and is answered as
 * such: the reader's action is to upgrade, not to republish.
 */
export function decodeManifest(bytes: Uint8Array): LineManifest | ShareMiss {
  let text = '';
  for (const byte of bytes) {
    if (byte > 0x7e) return { kind: 'unreadable', detail: 'the manifest is not ASCII' };
    text += String.fromCharCode(byte);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: 'unreadable', detail: 'the manifest is not JSON' };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { kind: 'unreadable', detail: 'the manifest is not an object' };
  }
  const { format, entries } = parsed as { format?: unknown; entries?: unknown };
  if (typeof format === 'number' && format > 1) return { kind: 'newer', names: [`manifest format ${String(format)}`] };
  if (format !== 1 || !Array.isArray(entries)) {
    return { kind: 'unreadable', detail: 'the manifest has no format 1 entry list' };
  }
  const held: HeldEntry[] = [];
  for (const entry of entries as unknown[]) {
    const checked = heldEntry(entry);
    if (checked === undefined) return { kind: 'unreadable', detail: 'the manifest holds a malformed entry' };
    held.push(checked);
  }
  return { format: 1, entries: held };
}

function heldEntry(value: unknown): HeldEntry | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { name, commit, head, images, digest, size } = value as Record<string, unknown>;
  if (typeof name !== 'string' || parseEntryName(name) === undefined) return undefined;
  if (typeof commit !== 'string' || !COMMIT.test(commit)) return undefined;
  if (head !== undefined && (typeof head !== 'string' || !COMMIT.test(head))) return undefined;
  if (typeof digest !== 'string' || !DIGEST.test(digest)) return undefined;
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 0) return undefined;
  if (images !== undefined) {
    if (!Array.isArray(images) || !images.every((image) => typeof image === 'string' && DIGEST.test(image))) {
      return undefined;
    }
  }
  return {
    name,
    commit,
    ...(head !== undefined ? { head: head as string } : {}),
    ...(images !== undefined ? { images: images as string[] } : {}),
    digest,
    size,
  };
}

/** Whether an entry offered for publishing is well formed, and why not. */
export function entryProblem(entry: ShareEntry): string | undefined {
  if (parseEntryName(entry.name) === undefined) {
    return `"${entry.name}" is not <family>-v<version>[/<qualifier>]`;
  }
  if (!COMMIT.test(entry.commit)) return `${entry.name}: "${entry.commit}" is not a commit`;
  if (entry.head !== undefined && !COMMIT.test(entry.head)) return `${entry.name}: "${entry.head}" is not a commit`;
  for (const image of entry.images ?? []) {
    if (!DIGEST.test(image)) return `${entry.name}: "${image}" is not a sha-256 digest`;
  }
  return undefined;
}

/**
 * Every blob path a manifest names. A backend that holds one line as one tree,
 * a git ref, keeps exactly these and drops the rest when it writes.
 */
export function manifestPaths(manifest: LineManifest): BlobPath[] {
  const paths = new Set<BlobPath>();
  for (const entry of manifest.entries) {
    paths.add(`entries/${entry.digest}`);
    for (const image of entry.images ?? []) paths.add(`images/${image}`);
  }
  return [...paths].sort();
}
