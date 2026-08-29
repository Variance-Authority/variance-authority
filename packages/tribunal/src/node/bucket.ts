import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import type { R2Like, R2ObjectLike } from '../bindings.js';

/**
 * R2, as a directory somebody owns.
 *
 * Four methods, and every one of them is a file operation. What makes this worth
 * a file of its own is not the I/O — it is that an object key is a *string this
 * package composed*, and a filesystem path is a thing an operating system
 * resolves. Between those two sits every traversal bug ever written, so the
 * mapping is checked rather than concatenated.
 *
 * ## Keys, and what may become a path
 *
 * The keys are built in [`store.ts`](../store.ts) and
 * [`review-write.ts`](../review-write.ts) and have three shapes:
 *
 * ```
 * <project>/baselines/<identityDigest>/<encoded subject>.png
 * <project>/cache/<identityDigest>/<documentDigest>.png
 * <project>/builds/<encoded build>/<encoded subject>-after.png
 * ```
 *
 * Every volatile segment is already `encodeURIComponent`'d, which removes `/`
 * and leaves `.` — so `..` is reachable only through `project`, which is an
 * operator's own string and is the one segment nothing encodes. Rather than
 * trusting that, every segment is checked here: this is the layer that owns the
 * filesystem, and a rule enforced where the risk is cannot be dropped by a
 * caller that forgets it exists.
 *
 * ## The hazard that is documented rather than solved
 *
 * **A case-insensitive filesystem folds two subjects into one.** macOS's default
 * APFS and Windows both do; `story:Card` and `story:card` are two baselines, two
 * rows, and one file. The consequence is a comparison against the wrong image,
 * which is the failure this project exists to refuse — so it is said here rather
 * than left for somebody to find.
 *
 * It is not solved by escaping, because escaping does not help: any encoding
 * that survives a case-folding filesystem has to fold case itself, which loses
 * the name. The plain-directory backend in
 * [`@variance-authority/store`](../../../store) makes the same trade with the
 * same layout, and the honest mitigation is the same one: on a case-insensitive
 * volume, a project whose subject ids differ only by case needs a different
 * volume. Case collisions are detected on `put` (below) rather than merged
 * silently.
 */

export interface DirectoryBucket extends R2Like {
  /** Where objects land, absolute. Printed at startup so the bytes can be found. */
  readonly root: string;
}

/**
 * Objects under `root`, one file per key, directories made on demand.
 *
 * `root` is created if it does not exist. It is not emptied, checked for
 * foreign files, or claimed: an operator pointing two projects at one directory
 * gets two project-prefixed trees, which is what the key layout is for.
 */
export function createDirectoryBucket(root: string): DirectoryBucket {
  const base = resolve(root);

  const pathOf = (key: string): string => {
    const full = join(base, ...segmentsOf(key));

    // The check that is not redundant with `segmentsOf`: a symlink inside the
    // tree can point out of it, and only the resolved path knows. Cheap, and it
    // is the last line before an `unlink`.
    if (full !== base && !full.startsWith(base + sep)) {
      throw new Error(`the object key ${JSON.stringify(key)} resolves outside ${base}`);
    }
    return full;
  };

  return {
    root: base,

    async get(key: string): Promise<R2ObjectLike | null> {
      const bytes = await readFile(pathOf(key)).catch(absentAsNull);
      if (bytes === null) return null;
      return {
        arrayBuffer: async (): Promise<ArrayBuffer> =>
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      };
    },

    /**
     * Existence without the bytes — a `stat`, which is what R2's `head` is.
     *
     * `describe` spends one of these per subject to confirm a sidecar row's
     * object is still there, so it is on the hot path of every run and must not
     * read a megabyte to answer a boolean.
     */
    async head(key: string): Promise<unknown | null> {
      const found = await stat(pathOf(key)).catch(absentAsNull);
      return found === null || !found.isFile() ? null : { key, size: found.size };
    },

    /**
     * Write, and make the write atomic.
     *
     * A baseline half on disk is worse than a baseline absent: `find` would
     * return a truncated PNG, the decoder would fail, and the failure would
     * arrive as a comparison error rather than as the disk-full it is. So the
     * bytes land beside the target and are renamed onto it, which is atomic
     * within a filesystem — and the temporary name carries the process id so two
     * services sharing a directory cannot rename each other's half-written file
     * into place.
     */
    async put(key: string, value: ArrayBuffer): Promise<unknown> {
      const target = pathOf(key);
      await mkdir(join(target, '..'), { recursive: true });

      const existing = await stat(target).catch(absentAsNull);
      if (existing !== null) await refuseCaseFold(target, key);

      const staging = `${target}.${process.pid}.${writes++}.part`;
      try {
        await writeFile(staging, new Uint8Array(value));
        await rename(staging, target);
      } catch (error) {
        await rm(staging, { force: true });
        throw error;
      }
      return { key };
    },

    async delete(keys: string | readonly string[]): Promise<unknown> {
      for (const key of typeof keys === 'string' ? [keys] : keys) {
        await rm(pathOf(key), { force: true });
      }
      return undefined;
    },
  };
}

/** Distinguishes "no such object" from "the disk said no", which are not the same answer. */
function absentAsNull(error: NodeJS.ErrnoException): null {
  if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
  throw error;
}

/**
 * Split a key into path segments, refusing every one that is not a file name.
 *
 * `.` and `..` are the traversal; the empty segment is a doubled slash, which
 * `join` would swallow and which would silently address a different object than
 * the key names. A backslash is refused because Windows treats it as a
 * separator and POSIX does not, and a store whose key space depends on the
 * host's opinion of one character is a store whose keys change when it moves.
 */
function segmentsOf(key: string): readonly string[] {
  if (key === '' || isAbsolute(key)) {
    throw new Error(`the object key ${JSON.stringify(key)} is not a relative key`);
  }

  const segments = key.split('/');
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..' || /[\\\0]/.test(segment)) {
      throw new Error(
        `the object key ${JSON.stringify(key)} has a segment (${JSON.stringify(segment)}) that ` +
          'is not a file name. Keys are composed by this package from the project name and ' +
          'percent-encoded ids; a project name containing a slash, a dot on its own, or a ' +
          'backslash is the way this happens',
      );
    }
  }
  return segments;
}

/**
 * Refuse a write that a case-folding volume would land on another key's object.
 *
 * Only reachable when the target already exists, and that is the whole subtlety:
 * "this object is being rewritten" and "a different key just folded onto this
 * one" are the same `stat` result, and only the directory listing tells them
 * apart. If the exact file name is present, the volume is not folding and the
 * write is an ordinary overwrite. If it is absent while the path resolves, the
 * volume folded — and the bytes about to be written belong to a different
 * subject than the ones already there.
 *
 * The opposite check — refusing on a case-*sensitive* volume because two
 * variants exist — would be wrong: there, they are two objects, correctly, and
 * refusing the second one would break a project whose subject ids differ by case
 * on exactly the filesystem that handles them properly.
 */
async function refuseCaseFold(target: string, key: string): Promise<void> {
  const directory = join(target, '..');
  const name = target.slice(directory.length + 1);
  const entries = await readdir(directory).catch(() => [] as string[]);
  if (entries.includes(name)) return;

  const folded = entries.find((entry) => entry.toLowerCase() === name.toLowerCase());
  if (folded === undefined) return;

  throw new Error(
    `the object key ${JSON.stringify(key)} resolves to an object stored under a different name ` +
      `(${JSON.stringify(folded)}) that differs from it only by case. This volume folds the two ` +
      'into one file, so writing here would replace another subject\'s image and every later ' +
      'comparison would run against the wrong one. Put the object store on a case-sensitive ' +
      'filesystem, or give the two subjects ids that differ by more than case',
  );
}

/** Distinguishes two staging files written in the same millisecond by one process. */
let writes = 0;
