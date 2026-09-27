import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rmdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  linePath,
  type BlobPath,
  type LineCell,
  type ShareLine,
  type ShareMiss,
} from '@variance-authority/core/share';

/**
 * Refuse a path that would leave the root.
 *
 * A path is built from a branch name and a digest, so this is not the usual
 * untrusted-path story — but a share is the one place where names from git and
 * a manifest meet a write, and a `..` that escaped here would write outside a
 * directory the operator scoped on purpose. Refused rather than sanitized,
 * because a path that means somewhere else has nothing in it to salvage.
 *
 * `what` names the path in the line's own terms — a line, an entry path, an
 * image path — because that is what a caller passed and what they can look for.
 */
function pathIn(root: string, relative: string, what: string): string {
  const path = join(root, normalize(relative));
  if (path !== root && !path.startsWith(root.endsWith(sep) ? root : root + sep)) {
    throw new OutsideRoot(`${what} resolves outside the share root ${root}`);
  }
  return path;
}

/** A path {@link pathIn} refused, which a cell answers as `refused` rather than as an outage. */
class OutsideRoot extends Error {}

/** How long a writer waits for another to finish with a line before calling it a conflict. */
const LOCK_WAIT_MS = 5_000;
/** A lock older than this was left by a writer that died, and is taken over. */
const LOCK_STALE_MS = 60_000;

/**
 * A line as files: `<root>/<kind>/<name>/manifest.json`, the line's entries
 * beside it, and `<root>/images/<digest>` shared by every line.
 *
 * A directory is the backend other transports already are: `aws s3 sync`
 * mirrors one, and an NFS mount and a developer's own `~/.cache` are one. So
 * the operator's choice of transport is very often not a choice of backend, and
 * the code path CI exercises is the one a laptop does.
 *
 * The version a write is conditional on is the digest of the manifest's bytes,
 * and the condition is held by a lock directory, because `mkdir` is the one
 * operation that is atomic on every filesystem an operator might point this at,
 * NFS included. A writer that dies holding it leaves a lock the next writer
 * takes over after a minute.
 *
 * A line's directory keeps the case of its name, so on a volume that folds case
 * two lines can be one directory. That line is refused and read as absent, never
 * merged (see {@link foldOf}).
 */
export function createDirectoryLineCell(root: string): LineCell {
  const lineDir = (line: ShareLine): string => pathIn(root, linePath(line), `${line.kind} ${line.name}`);
  const where = (line: ShareLine, path: BlobPath): string =>
    path.startsWith('images/')
      ? pathIn(root, path, `image path ${path}`)
      : pathIn(root, `${linePath(line)}/${path}`, `entry path ${path} on ${line.kind} ${line.name}`);

  async function read(dir: string): Promise<{ manifest: Uint8Array; version: string } | ShareMiss> {
    const held = await readHeld(join(dir, 'manifest.json'));
    if (!(held instanceof Uint8Array)) return held;
    return { manifest: held, version: createHash('sha256').update(held).digest('hex') };
  }

  /**
   * What a read found, or `absent` when it reached the line's directory only
   * through another spelling. Asked only after a read succeeds: a read that
   * fails reached nothing under any spelling.
   */
  async function own<T>(line: ShareLine, found: T): Promise<T | ShareMiss> {
    try {
      return (await foldOf(root, line)) === undefined ? found : { kind: 'absent' };
    } catch (error) {
      return missOf(join(root, line.kind), error);
    }
  }

  return {
    async load(line) {
      const held = await read(lineDir(line));
      return 'manifest' in held ? own(line, held) : held;
    },
    async blob(line, path) {
      try {
        const held = await readHeld(where(line, path));
        // An image is kept once for every line, outside any line's directory, so no line's spelling decides it.
        return held instanceof Uint8Array && !path.startsWith('images/') ? await own(line, held) : held;
      } catch (error) {
        return missOf(path, error);
      }
    },
    async store(line, write) {
      const dir = lineDir(line);
      const lock = join(dir, '.lock');
      try {
        await mkdir(dir, { recursive: true });
        // After the mkdir, so it holds against a writer in any process: once the
        // directory exists its spelling is fixed, and the writer whose mkdir
        // found it made under another spelling sees that spelling here.
        const fold = await foldOf(root, line);
        if (fold !== undefined) {
          return {
            kind: 'refused',
            detail:
              `${line.kind} ${line.name} names ${JSON.stringify(fold.segment)} in ${fold.directory}, and this ` +
              `volume stores ${JSON.stringify(fold.stored)} there. The two names differ only by case and this ` +
              'volume treats them as one name, so this write would change another line. Put the share on a ' +
              'case-sensitive volume, or give the two branches names that differ by more than case',
          };
        }
        if (!(await acquire(lock))) return 'conflict';
      } catch (error) {
        return missOf(dir, error);
      }
      try {
        // The spelling was checked above and cannot change, so the manifest is read without asking again.
        const held = await read(dir);
        const version = 'version' in held ? held.version : undefined;
        if (!('version' in held) && held.kind !== 'absent') return held;
        if (version !== write.expected) return 'conflict';
        // TODO: an entry or image no manifest names any more stays on disk, and a
        // branch's line outlives the branch; nothing here deletes.
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

/** The first segment of a line's name that the volume stores under another spelling. */
interface Fold {
  /** The directory the segment was looked up in. */
  readonly directory: string;
  /** The segment as the line spells it. */
  readonly segment: string;
  /** The segment as the volume stores it. */
  readonly stored: string;
}

/**
 * Where a line's directory resolves only through a segment the volume stores
 * under another spelling, or `undefined` when every segment is stored as the
 * line spells it.
 *
 * `linePath` keeps a branch name's case, and the default volumes on macOS and
 * Windows fold it, so `Feature` and `feature` are two lines and one directory.
 * Escaping cannot keep them apart: an encoding that survives a folding volume
 * has to fold case itself, and so loses the name. The collision is detected
 * instead, on the name's segments only: the root is the operator's path, and
 * the kind is spelled by this code.
 *
 * Asked only of a directory known to exist, after a read that succeeded or a
 * `mkdir`, so every segment resolves and a segment its parent does not list is
 * one the volume answered under another spelling. The listing is compared
 * exactly. On a case-sensitive volume `Feature` and `feature` are two
 * directories, correctly, and a comparison that lowercased would refuse the
 * second on exactly the volume that keeps them apart.
 */
async function foldOf(root: string, line: ShareLine): Promise<Fold | undefined> {
  let directory = join(root, line.kind);
  for (const segment of linePath(line).split('/').slice(1)) {
    const listed = await readdir(directory);
    if (!listed.includes(segment)) {
      const lower = segment.toLowerCase();
      return { directory, segment, stored: listed.find((name) => name.toLowerCase() === lower) ?? segment };
    }
    directory = join(directory, segment);
  }
  return undefined;
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
  if (error instanceof OutsideRoot) return { kind: 'refused', detail: error.message };
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'ENOENT' || code === 'ENOTDIR') return { kind: 'absent' };
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
    return { kind: 'refused', detail: `${path}: ${String(code)}` };
  }
  return { kind: 'unreachable', detail: `${path}: ${(error as Error).message}` };
}

export { createGitLineCell, gitDescends, type GitLineOptions } from './share-git.js';
