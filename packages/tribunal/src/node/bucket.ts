import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve, sep } from 'node:path';
import type { R2Like, R2ObjectLike, R2PutOptions, R2Written } from '../bindings.js';
import { FoldedKey } from '../worker-http.js';

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
 * Every key this package writes is built in [`objects.ts`](../objects.js) and
 * has one shape:
 *
 * ```
 * <project>/objects/<sha256 of the bytes>.png
 * ```
 *
 * A share stores its lines beside them, under names `linePath` has already cut
 * down to `[A-Za-z0-9._-]` segments:
 *
 * ```
 * <project>/share/<mainline|branch>/<line…>/manifest.json
 * <project>/share/<mainline|branch>/<line…>/entries/<sha256>
 * <project>/share/images/<sha256>
 * ```
 *
 * The digest is hex, so the only segment that is not already fixed by
 * construction is `project` — an operator's own string, and the one thing
 * nothing encodes. Rather than trusting that, every segment is checked here:
 * this is the layer that owns the filesystem, and a rule enforced where the risk
 * is cannot be dropped by a caller that forgets it exists.
 *
 * Deployments written before content keys still hold the three shapes that came
 * before, and still read them — the key is a column rather than something a
 * lookup derives:
 *
 * ```
 * <project>/baselines/<identityDigest>/<encoded subject>.png
 * <project>/cache/<identityDigest>/<documentDigest>.png
 * <project>/builds/<encoded build>/<encoded subject>.<kind>.png
 * ```
 *
 * ## The hazard that is detected rather than solved
 *
 * **A case-insensitive filesystem folds two keys into one path.** macOS's default
 * APFS and Windows both do. A share line names its branch in a directory, so
 * `branch/Feature/manifest.json` and `branch/feature/manifest.json` are two lines
 * and, folded, one directory: a read of one returns the other's record and a
 * publish to one replaces the other's. The keys written before content keys fold
 * the same way — `story:Card` and `story:card` are two baselines, two rows and
 * one file — and the consequence there is a comparison against the wrong image,
 * which is the failure this project exists to refuse.
 *
 * It is not solved by escaping, because escaping does not help: any encoding
 * that survives a case-folding filesystem has to fold case itself, which loses
 * the name. The plain-directory backend in
 * [`@variance-authority/store`](../../../store) makes the same trade with the
 * same layout, and the mitigation is the same one: on a case-insensitive volume,
 * a project whose keys differ only by case needs a different volume.
 *
 * So collisions are detected rather than merged silently, on every segment of
 * the key below the root and not only its file name (see {@link foldOf}). A key
 * whose path resolves only through a segment stored under another spelling does
 * not exist: `get` and `head` answer `null` and `delete` removes nothing. `put`
 * refuses it, because writing there would change another key's object.
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

  // FIXME: a conditional write is exclusive only within this process. Two
  // services sharing one storage directory can both pass the same `onlyIf` and
  // the later rename wins, so two share publishers racing through two processes
  // can lose an entry. A lock file beside the target would close it.
  const pending = new Map<string, Promise<void>>();

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
  const write = async (target: string, value: ArrayBuffer): Promise<R2Written> => {
    const bytes = new Uint8Array(value);
    const staging = `${target}.${process.pid}.${writes++}.part`;
    try {
      await writeFile(staging, bytes);
      await rename(staging, target);
    } catch (error) {
      await rm(staging, { force: true });
      throw error;
    }
    return { httpEtag: `"${etagOf(bytes)}"` };
  };

  /** Whether the key's path lands only on objects stored under another spelling. */
  const folded = async (key: string): Promise<boolean> => (await foldOf(base, segmentsOf(key))) !== undefined;

  // The message names the key's own directory, never this machine's path: it
  // reaches the caller that sent the key.
  const refuseFold = async (key: string): Promise<void> => {
    const fold = await foldOf(base, segmentsOf(key));
    if (fold === undefined) return;
    throw new FoldedKey(
      `the object key ${JSON.stringify(key)} names ${JSON.stringify(fold.segment)} in ` +
        `${JSON.stringify(fold.directory)}, where this store holds ${JSON.stringify(fold.stored)}. ` +
        'The two names differ only by case and the volume this store is on treats them as one ' +
        'name, so the write would change the objects of another key. Put the object store on a ' +
        'case-sensitive volume, or give the two keys names that differ by more than case',
    );
  };

  /**
   * Make the key's directory, refusing a key that reaches another key's
   * directory before and after.
   *
   * Before, so a key that folds onto an existing directory creates nothing
   * inside it. After, because two keys that differ only by case, written at the
   * same moment, both pass the first check while neither directory exists. A
   * directory's spelling is fixed by the `mkdir` that made it, so the write that
   * lost sees the winner's spelling and is refused, in this process or another.
   */
  const prepare = async (key: string, target: string): Promise<void> => {
    await refuseFold(key);
    await mkdir(join(target, '..'), { recursive: true });
    await refuseFold(key);
  };

  return {
    root: base,

    async get(key: string): Promise<R2ObjectLike | null> {
      const bytes = await readFile(pathOf(key)).catch(absentAsNull);
      if (bytes === null || (await folded(key))) return null;
      return {
        httpEtag: `"${etagOf(bytes)}"`,
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
      if (found === null || !found.isFile() || (await folded(key))) return null;
      return { key, size: found.size };
    },

    /**
     * Write, or with `onlyIf`, write only when the stored version agrees — R2's
     * `put`, which answers `null` rather than throwing when the condition fails.
     */
    async put(key: string, value: ArrayBuffer, options?: R2PutOptions): Promise<R2Written | null> {
      const target = pathOf(key);
      const onlyIf = options?.onlyIf;
      if (onlyIf === undefined) {
        await prepare(key, target);
        return write(target, value);
      }

      // A condition is a read and a write that must not interleave with another
      // conditional write to the same key, so those are queued per key. The
      // queue is this process's; see the FIXME above for two processes.
      const before = pending.get(target) ?? Promise.resolve();
      const turn = before.then(async () => {
        // Before the condition is read: a folded path would compare against the
        // other key's version and answer a stale write rather than the collision.
        await prepare(key, target);
        const current = await readFile(target).catch(absentAsNull);
        const etag = current === null ? undefined : etagOf(current);
        const matches = (wanted: string): boolean => etag !== undefined && (wanted === '*' || wanted === etag);
        if (onlyIf.etagMatches !== undefined && !matches(onlyIf.etagMatches)) return null;
        if (onlyIf.etagDoesNotMatch !== undefined && matches(onlyIf.etagDoesNotMatch)) return null;
        return write(target, value);
      });
      const settled = turn.then(
        () => undefined,
        () => undefined,
      );
      pending.set(target, settled);
      void settled.then(() => {
        if (pending.get(target) === settled) pending.delete(target);
      });
      return turn;
    },

    async delete(keys: string | readonly string[]): Promise<unknown> {
      for (const key of typeof keys === 'string' ? [keys] : keys) {
        const path = pathOf(key);
        // A folded key names nothing, and removing the path would remove another key's object.
        if (!(await folded(key))) await rm(path, { force: true });
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

/** The first segment of a key that the volume holds under another spelling. */
interface Fold {
  /** The key's own directory the segment was looked up in, empty at the root. */
  readonly directory: string;
  /** The segment as the key spells it. */
  readonly segment: string;
  /** The segment as the volume stores it. */
  readonly stored: string;
}

/**
 * Where a key reaches an existing file or directory only by a spelling it does
 * not use, or `undefined` when every segment that exists is stored exactly as
 * the key spells it.
 *
 * Every segment below the root is checked, not only the last: a share line's
 * branch is a directory, so the collision is in the middle of the key. The walk
 * stops at the first segment that does not exist, because nothing beneath it
 * does either, and a key that ends there is new.
 *
 * The opposite check — refusing on a case-*sensitive* volume because two
 * spellings exist — would be wrong: there, they are two objects, correctly, and
 * refusing the second one would break a project whose keys differ by case on
 * exactly the filesystem that keeps them apart.
 */
async function foldOf(base: string, segments: readonly string[]): Promise<Fold | undefined> {
  const directories = segments.map((_, index) => join(base, ...segments.slice(0, index)));
  // Independent lookups, so they run together; the loop below reads them in key order.
  const spellings = await Promise.all(segments.map((segment, index) => storedName(directories[index]!, segment)));
  for (const [index, stored] of spellings.entries()) {
    if (stored === null) return undefined;
    const segment = segments[index]!;
    if (stored !== segment) return { directory: segments.slice(0, index).join('/'), segment, stored };
  }
  return undefined;
}

/**
 * How `directory` stores `name`, or `null` when nothing answers to it.
 *
 * The volume is asked rather than listed, because a listing of a directory
 * holding every image of a project costs milliseconds on every read. The same
 * name with its case inverted is looked up beside it: on a case-sensitive volume
 * that is another name, absent or another inode, and the answer is `name`
 * without further work. Where the two share an inode the volume folds, and
 * `realpath` names the stored spelling. The listing is the fallback for the
 * cases `realpath` cannot answer: a symlink, which it would follow, and a
 * platform whose `realpath` repeats the spelling it was given.
 */
async function storedName(directory: string, name: string): Promise<string | null> {
  const found = await lstat(join(directory, name), { bigint: true }).catch(absentAsNull);
  if (found === null) return null;

  const inverted = [...name].map((c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase())).join('');
  if (inverted === name) return name;
  const other = await lstat(join(directory, inverted), { bigint: true }).catch(absentAsNull);
  if (other === null || other.ino !== found.ino || other.dev !== found.dev) return name;

  if (!found.isSymbolicLink()) {
    const resolved = basename(await realpath(join(directory, inverted)));
    if (resolved === name) return name;
    if (resolved !== inverted) return resolved;
  }
  const entries = await readdir(directory).catch(absentAsNull);
  if (entries === null) return null;
  if (entries.includes(name)) return name;
  return entries.find((entry) => entry.toLowerCase() === name.toLowerCase()) ?? name;
}

/**
 * An object's version: the MD5 of its bytes, which is what R2 answers for an
 * object written in one part. Derived from the content rather than kept beside
 * it, so a file somebody replaced by hand still answers a version that differs.
 */
function etagOf(bytes: Uint8Array): string {
  return createHash('md5').update(bytes).digest('hex');
}

/** Distinguishes two staging files written in the same millisecond by one process. */
let writes = 0;
