/**
 * Content digests for the whole repository, from git, without reading a file.
 *
 * A scan needs two things per file: a digest, to know whether it moved, and its
 * imports. Computing the digest the obvious way costs a read of every file in the
 * repository, which at four hundred files is nothing and at two hundred thousand
 * is the scan.
 *
 * Git already did it. Every blob in a tree is named by the hash of its contents —
 * that is what a git object *is* — so `ls-tree -r` hands over the entire file list
 * with a content digest attached, in one subprocess, having opened nothing. Paired
 * with a cache keyed by that digest ([`cache.ts`](./cache.ts)), a scan reads only
 * the files whose blob changed: `O(diff)` rather than `O(repository)`.
 *
 * ## The working tree is not the commit
 *
 * `ls-tree` describes `HEAD`. A developer's checkout has edits in it, and using
 * the committed digest for an edited file would be the one unforgivable error —
 * a file that moved, reported as still. So the porcelain status is read too, and
 * every path it names is re-hashed from disk by `hash-object`, which produces the
 * same kind of digest for the bytes that are actually there. A file edited back to
 * its committed contents therefore lands on its committed digest, and nothing runs
 * for it.
 *
 * Deleted paths are dropped rather than carried, and a path git does not know
 * about at all gets no digest — the scan hashes those itself.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Digest } from '@variance-authority/core/format';

const run = promisify(execFile);

/** Enough for a repository of two hundred thousand paths. */
const MAX_OUTPUT = 256 * 1024 * 1024;

/**
 * Every tracked path under `root`, with the digest of the bytes on disk.
 *
 * `undefined` when this is not a git checkout, or when git cannot answer. Not an
 * error: the scanner's own digest is correct and merely slower, and a tool that
 * refused to run outside a repository would be useless in exactly the tarball and
 * sandbox cases it should handle quietly.
 */
export async function gitDigests(root: string): Promise<ReadonlyMap<string, Digest> | undefined> {
  let listing: string;
  try {
    ({ stdout: listing } = await run('git', ['ls-tree', '-r', '-z', 'HEAD'], {
      cwd: root,
      maxBuffer: MAX_OUTPUT,
    }));
  } catch {
    return undefined;
  }

  const digests = new Map<string, Digest>();
  for (const entry of listing.split('\0')) {
    // `<mode> <type> <object>\t<path>`, and only blobs are files.
    const tab = entry.indexOf('\t');
    if (tab === -1) continue;

    const fields = entry.slice(0, tab).split(' ');
    if (fields[1] !== 'blob' || fields[2] === undefined) continue;

    digests.set(entry.slice(tab + 1), blob(fields[2]));
  }

  await overlayWorkingTree(root, digests);

  return digests;
}

/**
 * Replace the committed digest of every path the working tree disagrees about.
 *
 * Failure here removes the disagreeing paths rather than leaving them: a stale
 * digest on an edited file is a subject nobody observes, and no digest at all is
 * a file the scan hashes for itself.
 */
async function overlayWorkingTree(root: string, digests: Map<string, Digest>): Promise<void> {
  let status: string;
  try {
    ({ stdout: status } = await run(
      'git',
      ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
      { cwd: root, maxBuffer: MAX_OUTPUT },
    ));
  } catch {
    digests.clear();
    return;
  }

  const dirty: string[] = [];
  const fields = status.split('\0');

  for (let at = 0; at < fields.length; at += 1) {
    const entry = fields[at]!;
    if (entry.length < 4) continue;

    const codes = entry.slice(0, 2);
    const path = entry.slice(3);

    // A rename carries its old path as the next field, and that path is gone.
    if (codes.includes('R')) {
      const from = fields[at + 1];
      if (from !== undefined) digests.delete(from);
      at += 1;
    }

    if (codes.includes('D')) digests.delete(path);
    else dirty.push(path);
  }

  if (dirty.length === 0) return;

  for (const [path, digest] of await hashOnDisk(root, dirty)) digests.set(path, digest);
  for (const path of dirty) {
    // Hashed nothing: the file is unreadable or vanished between the two calls.
    // Removing the entry hands the question back to the scan rather than
    // answering it with a digest for contents nobody saw.
    if (!digests.has(path)) digests.delete(path);
  }
}

/**
 * Blob digests for the bytes currently on disk.
 *
 * One subprocess for every path, because `hash-object` reads its list from stdin.
 * The paths come back in the order they went in, which is the only thing pairing
 * them — `hash-object` prints digests and nothing else.
 */
async function hashOnDisk(
  root: string,
  paths: readonly string[],
): Promise<ReadonlyMap<string, Digest>> {
  const hashed = new Map<string, Digest>();

  let stdout: string;
  try {
    const child = run('git', ['hash-object', '--stdin-paths'], {
      cwd: root,
      maxBuffer: MAX_OUTPUT,
    });
    child.child.stdin?.end(`${paths.join('\n')}\n`);
    ({ stdout } = await child);
  } catch {
    return hashed;
  }

  const lines = stdout.split('\n').filter((line) => line !== '');
  // A short answer means git stopped early — on a directory, or a path it could
  // not open. Pairing the survivors by position would attach one file's digest to
  // another's name, so the whole batch is discarded instead.
  if (lines.length !== paths.length) return hashed;

  for (const [at, line] of lines.entries()) hashed.set(paths[at]!, blob(line.trim()));

  return hashed;
}

/**
 * A git object name as a digest.
 *
 * Prefixed, because this repository's own digests are `v1:` and the two schemes
 * must never be compared as though they were one. A closure computed from git
 * digests and one computed from read contents differ at every node, which costs a
 * whole run and cannot cause a missed one.
 */
function blob(object: string): Digest {
  return `git:${object}`;
}
