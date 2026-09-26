import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rmdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  linePath,
  neverFails,
  type BlobPath,
  type LineCell,
  type ShareLine,
  type ShareMiss,
  type SharedCache,
} from '@variance-authority/core/share';

/**
 * A shared evaluation as files under one directory.
 *
 * The backend everything else wraps. `actions/cache` restores and saves a path;
 * `aws s3 sync` mirrors a path; an NFS mount, a build-server workspace and a
 * developer's own `~/.cache` are a path. So the operator's choice of transport
 * is very often not a choice of backend at all — it is this one, with somebody
 * else moving the directory — and the code path CI exercises is the same one a
 * laptop does.
 *
 * That is the reason a directory is first among equals rather than a fallback.
 * A GitHub Actions job that restores a key into this root and saves it after is
 * a complete sharing arrangement with no service, no credentials and no code in
 * this repository that knows GitHub exists.
 *
 * Writes land through a temporary file in the same directory and a rename,
 * because two jobs on one runner may publish at once and a half-written segment
 * is refused by its reader — an outcome that costs a rebuild, which is the whole
 * budget this object has.
 */
export function createDirectoryShare(root: string): SharedCache {
  return neverFails({
    async get(key) {
      // Handed back as a plain `Uint8Array` rather than the `Buffer` Node
      // returns. The contract is a platform-free one and the readers on the
      // other side of it are too; a `Buffer` would work and would quietly make
      // every one of them a Node reader by inheritance.
      const held = await readFile(pathIn(root, key));
      return new Uint8Array(held.buffer, held.byteOffset, held.byteLength);
    },
    async put(key, bytes) {
      const path = pathIn(root, key);
      await mkdir(dirname(path), { recursive: true });
      // Unique per call rather than per key: the collision this avoids is two
      // publishers of the *same* key, which is the common one, since two jobs
      // at one commit publish identical bytes.
      const staged = `${path}.${process.pid.toString(36)}${Date.now().toString(36)}.part`;
      await writeFile(staged, bytes);
      await rename(staged, path);
    },
  });
}

/**
 * Refuse a key that would leave the root.
 *
 * A key is built from a project name and a commit, so this is not the usual
 * untrusted-path story — but a share is the one place where bytes from a config
 * file meet a write, and a `..` that escaped here would write outside a
 * directory the operator scoped on purpose. Refused rather than sanitized,
 * because the caller's answer to a refusal is the same as its answer to a miss
 * and there is nothing to salvage.
 */
function pathIn(root: string, key: string): string {
  const path = join(root, normalize(key));
  if (path !== root && !path.startsWith(root.endsWith(sep) ? root : root + sep)) {
    throw new Error(`share key leaves its root: ${key}`);
  }
  return path;
}

/** How long a writer waits for another to finish with a line before calling it a conflict. */
const LOCK_WAIT_MS = 5_000;
/** A lock older than this was left by a writer that died, and is taken over. */
const LOCK_STALE_MS = 60_000;

/**
 * A line as files: `<root>/<kind>/<name>/manifest.json`, the line's entries
 * beside it, and `<root>/images/<digest>` shared by every line.
 *
 * The version a write is conditional on is the digest of the manifest's bytes,
 * and the condition is held by a lock directory, because `mkdir` is the one
 * operation that is atomic on every filesystem an operator might point this at,
 * NFS included. A writer that dies holding it leaves a lock the next writer
 * takes over after a minute.
 */
export function createDirectoryLineCell(root: string): LineCell {
  const lineDir = (line: ShareLine): string => pathIn(root, linePath(line));
  const where = (line: ShareLine, path: BlobPath): string =>
    path.startsWith('images/') ? pathIn(root, path) : pathIn(root, `${linePath(line)}/${path}`);

  async function load(line: ShareLine): Promise<{ manifest: Uint8Array; version: string } | ShareMiss> {
    const held = await readHeld(join(lineDir(line), 'manifest.json'));
    if (!(held instanceof Uint8Array)) return held;
    return { manifest: held, version: createHash('sha256').update(held).digest('hex') };
  }

  return {
    load,
    async blob(line, path) {
      return readHeld(where(line, path));
    },
    async store(line, write) {
      const dir = lineDir(line);
      const lock = join(dir, '.lock');
      try {
        await mkdir(dir, { recursive: true });
        if (!(await acquire(lock))) return 'conflict';
      } catch (error) {
        return missOf(dir, error);
      }
      try {
        const held = await load(line);
        const version = 'version' in held ? held.version : undefined;
        if (!('version' in held) && held.kind !== 'absent') return held;
        if (version !== write.expected) return 'conflict';
        // TODO: an entry or image no manifest names any more stays on disk;
        // nothing here deletes.
        for (const [path, bytes] of write.blobs) await place(where(line, path), bytes);
        await place(join(dir, 'manifest.json'), write.manifest);
        return 'written';
      } catch (error) {
        return missOf(dir, error);
      } finally {
        await rmdir(lock).catch(() => undefined);
      }
    },
  };
}

async function acquire(lock: string): Promise<boolean> {
  const until = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      await mkdir(lock);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const since = await stat(lock).then((held) => Date.now() - held.mtimeMs, () => 0);
    if (since > LOCK_STALE_MS) await rmdir(lock).catch(() => undefined);
    else if (Date.now() > until) return false;
    else await sleep(20);
  }
}

let placed = 0;

async function place(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  // Counted as well as timed: two lines placing one image in one millisecond
  // would otherwise stage it under one name, and one rename would find nothing.
  placed += 1;
  const staged = `${path}.${process.pid.toString(36)}${Date.now().toString(36)}-${placed.toString(36)}.part`;
  await writeFile(staged, bytes);
  await rename(staged, path);
}

async function readHeld(path: string): Promise<Uint8Array | ShareMiss> {
  try {
    const held = await readFile(path);
    return new Uint8Array(held.buffer, held.byteOffset, held.byteLength);
  } catch (error) {
    return missOf(path, error);
  }
}

function missOf(path: string, error: unknown): ShareMiss {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'ENOENT' || code === 'ENOTDIR') return { kind: 'absent' };
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
    return { kind: 'refused', detail: `${path}: ${String(code)}` };
  }
  return { kind: 'unreachable', detail: `${path}: ${(error as Error).message}` };
}

export { createGitLineCell, type GitLineOptions } from './share-git.js';
