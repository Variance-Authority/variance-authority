/**
 * What a patch names at each end of a file, read from git by blob name.
 *
 * A patch's `index <before>..<after>` line is git's name for both ends of the
 * file it changes. Every blob a caller wants is read in one `git cat-file
 * --batch`, so a patch naming a hundred files costs one git process, not two
 * hundred.
 */

// compass: variance-authority.reach

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** A file a patch changes, and the blob names its `index` line gives each end. */
export interface PatchEntry {
  readonly path: string;
  /** Whether an `index` line named the blobs at all; an absent end is an all-zero name. */
  readonly indexed: boolean;
  readonly before?: string;
  readonly after?: string;
}

/** Every file a patch changes whose path `wanted` accepts, in patch order. */
export function entriesIn(patch: string, wanted: (path: string) => boolean): readonly PatchEntry[] {
  const found: PatchEntry[] = [];
  const lines = patch.split('\n');
  for (let at = 0; at < lines.length; at += 1) {
    const header = /^diff --git a\/(.+) b\/(.+)$/u.exec(lines[at]!);
    if (header === null || !wanted(header[2]!)) continue;
    let entry: PatchEntry = { path: header[2]!, indexed: false };
    for (let next = at + 1; next < lines.length && !lines[next]!.startsWith('diff --git '); next += 1) {
      const index = /^index ([0-9a-f]+)\.\.([0-9a-f]+)/u.exec(lines[next]!);
      if (index === null) continue;
      const absent = (id: string) => /^0+$/u.test(id);
      entry = {
        path: header[2]!,
        indexed: true,
        ...(absent(index[1]!) ? {} : { before: index[1]! }),
        ...(absent(index[2]!) ? {} : { after: index[2]! }),
      };
      break;
    }
    found.push(entry);
  }
  return found;
}

/** The two ends of each patched file, read from its blob names; see {@link patchEnds}. */
export interface PatchEnds {
  readonly before: (entry: PatchEntry) => string | undefined;
  readonly after: (entry: PatchEntry) => string | undefined;
}

/**
 * Both ends of every entry, in two git processes however many entries there
 * are: one `cat-file --batch` for every blob named, then one `hash-object` for
 * the working-tree files whose after-blob git does not hold. Such a file is the
 * after end when it hashes to the name the patch gives it.
 */
export async function patchEnds(entries: readonly PatchEntry[], root: string): Promise<PatchEnds> {
  const named = entries.filter((entry) => entry.indexed);
  const texts = await blobs(
    named.flatMap((entry) => [entry.before, entry.after].filter((id) => id !== undefined)),
    root,
  );
  const unheld = named.filter((entry) => entry.after !== undefined && !texts.has(entry.after));
  const onDisk = await worktree(unheld, root);
  return {
    before: (entry) => (entry.before === undefined ? undefined : texts.get(entry.before)),
    after: (entry) => (entry.after === undefined ? undefined : (texts.get(entry.after) ?? onDisk.get(entry.path))),
  };
}

/**
 * The text of each blob git holds among `ids`, keyed by the name it was asked
 * by, read through one `git cat-file --batch`. An id git does not hold, or a
 * read that fails, has no entry.
 */
export async function blobs(ids: readonly string[], root: string): Promise<ReadonlyMap<string, string>> {
  const asked = [...new Set(ids)];
  const texts = new Map<string, string>();
  if (asked.length === 0) return texts;
  let stdout: Buffer;
  try {
    stdout = await run('git', ['cat-file', '--batch'], root, `${asked.join('\n')}\n`);
  } catch {
    return texts;
  }
  // Each answer is `<sha> <type> <size>\n<bytes>\n`, or `<id> missing\n`, in the order asked.
  let at = 0;
  for (const id of asked) {
    const end = stdout.indexOf(10, at);
    if (end === -1) break;
    const header = stdout.toString('utf8', at, end).split(' ');
    at = end + 1;
    if (header.length !== 3) continue;
    const size = Number(header[2]);
    if (header[1] === 'blob') texts.set(id, stdout.toString('utf8', at, at + size));
    at += size + 1;
  }
  return texts;
}

/**
 * The working-tree text of each entry whose file, under `root`, hashes to its
 * after-blob name. A file that does not read is left out before git is asked,
 * since `hash-object --stdin-paths` stops at the first path it cannot open; the
 * rest are hashed by absolute path, so git hashes the file that was read.
 */
async function worktree(entries: readonly PatchEntry[], root: string): Promise<ReadonlyMap<string, string>> {
  const read = await Promise.all(
    entries.map(async (entry) => {
      const file = join(root, entry.path);
      const text = await readFile(file, 'utf8').catch(() => undefined);
      return text === undefined ? [] : [{ entry, file, text }];
    }),
  );
  const found = read.flat();
  const texts = new Map<string, string>();
  if (found.length === 0) return texts;
  let hashes: string[];
  try {
    const stdout = await run('git', ['hash-object', '--stdin-paths'], root, `${found.map((one) => one.file).join('\n')}\n`);
    hashes = stdout.toString('utf8').trim().split('\n');
  } catch {
    return texts;
  }
  found.forEach((one, at) => {
    if (hashes[at]?.startsWith(one.entry.after!)) texts.set(one.entry.path, one.text);
  });
  return texts;
}

/**
 * A process's stdout, with `input` written to its stdin. A process that exits
 * before reading all of it is its own failure, so the broken pipe is not.
 */
function run(command: string, args: readonly string[], cwd: string, input: string): Promise<Buffer> {
  return new Promise((done, fail) => {
    const child = execFile(command, args, { cwd, encoding: 'buffer', maxBuffer: 1024 * 1024 * 1024 }, (error, stdout) =>
      error ? fail(error) : done(stdout),
    );
    child.stdin?.on('error', () => {});
    child.stdin?.end(input);
  });
}
