import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import { neverFails, type SharedCache } from '@variance-authority/core/share';

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
