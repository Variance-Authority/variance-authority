import { readFile, realpath } from 'node:fs/promises';
import { relative, sep } from 'node:path';
import { messageOf, RasterStoreError, REFUSAL } from '@variance-authority/raster';
import type { ImageReader } from './durable.js';
import type { CommandRunner } from './lfs.js';

/**
 * The images a run compares, fetched when it compares them.
 *
 * A clone made with `GIT_LFS_SKIP_SMUDGE=1` holds a pointer at every baseline's
 * path. Most of a run never needs the image behind one: `describe` settles a
 * subject whose document did not move from its sidecar, and the sidecars are
 * text. The image is needed when `find` is asked for it, so that is when it is
 * fetched — a run downloads the baselines of the subjects that changed, where
 * `git lfs pull` would download every baseline in the repository.
 *
 * git-lfs moves the bytes and checks the file out; nothing here writes an image
 * or decides where one is. The durable store says which file it read, and this
 * names that file to `git lfs pull --include`.
 */

/** First bytes of an LFS pointer file, per the git-lfs v1 pointer spec. */
export const POINTER_PREFIX = 'version https://git-lfs.github.com/spec/';

/**
 * The longest `--include` one pull is handed.
 *
 * Under Windows' 32 767-character command line and Linux's 128 KiB per
 * argument, with room for the rest. A batch longer than this is split into
 * consecutive pulls rather than failing to spawn.
 */
const INCLUDE_BUDGET = 8000;

export function isPointer(bytes: Buffer): boolean {
  return bytes.subarray(0, POINTER_PREFIX.length).toString('utf8') === POINTER_PREFIX;
}

/**
 * A reader that returns the image, fetching it first if the file is a pointer.
 *
 * **One pull at a time, and no waiting to start one.** The run's lanes look
 * baselines up concurrently, so pointers arrive in bursts. The first pointer
 * starts a pull at once; every pointer met while that pull runs joins the next
 * one, which starts when it finishes. A pull per pointer would cost a process
 * and a round trip to the LFS server each, and a timer that waited to collect
 * more would be a guess about how fast the lanes are.
 *
 * A pull that fails refuses every lookup that was waiting on it: the pointer is
 * still all there is, and a pointer read as an absent baseline is `new`, which
 * re-records whatever is on screen over the baseline nobody could download.
 */
export function fetchingReader(cwd: string, run: CommandRunner): ImageReader {
  let toplevel: Promise<string> | undefined;
  let running = false;
  let next: Batch | undefined;

  const pull = async (files: readonly string[]): Promise<void> => {
    toplevel ??= locate(cwd, run);
    const top = await toplevel;
    const patterns = await Promise.all(files.map(async (file) => patternFor(top, await realpath(file))));
    for (const include of chunked(patterns)) await pullOnce(cwd, run, include);
  };

  const drain = (): void => {
    const batch = next;
    next = undefined;
    if (batch === undefined) return;
    running = true;
    const files = [...batch.files];
    pull(files)
      .then(batch.settle, (error: unknown) => batch.refuse(refusal(files, error)))
      .finally(() => {
        running = false;
        drain();
      });
  };

  const fetched = (file: string): Promise<void> => {
    next ??= batch();
    next.files.add(file);
    const { done } = next;
    if (!running) drain();
    return done;
  };

  return async (file) => {
    const bytes = await readFile(file);
    if (!isPointer(bytes)) return bytes;
    await fetched(file);
    return reread(file);
  };
}

/**
 * The file again, after its pull: the image, or a refusal.
 *
 * `git lfs pull` exits 0 without checking a file out when git-lfs is installed
 * but was never set up in the repository — it says so and skips the checkout — or
 * when the pattern matched nothing. The file is still a pointer then, and the
 * remedy is not the one for a machine without git-lfs. A file gone since the
 * pull is refused too: read as ENOENT, it would be an absent baseline.
 */
async function reread(file: string): Promise<Buffer> {
  let bytes: Buffer;
  try {
    bytes = await readFile(file);
  } catch (error) {
    throw refusal([file], error);
  }
  if (!isPointer(bytes)) return bytes;
  throw new RasterStoreError(
    `${file} is still a git-LFS pointer after \`git lfs pull\` exited 0, so the image was ` +
      'not checked out. git-lfs skips the checkout in a repository it was never set up in: ' +
      'run `git lfs install --local` (add `--skip-smudge` to keep checkouts from downloading ' +
      `every image). ${REFUSAL}.`,
  );
}

/**
 * Every failure of a fetch as a refusal, whatever threw it.
 *
 * The reader's caller reads ENOENT as "no image here", and a fetch can meet one
 * of its own — a work tree root that does not resolve, a file gone between the
 * read and the pull. Let through, that is a pointer reported as a missing
 * image: a corrupted baseline at best, and `new` at worst.
 */
function refusal(files: readonly string[], error: unknown): RasterStoreError {
  if (error instanceof RasterStoreError) return error;
  return new RasterStoreError(
    `${files.join(', ')} ${files.length === 1 ? 'is a git-LFS pointer' : 'are git-LFS pointers'}, ` +
      `and fetching the image failed (${messageOf(error)}). ${REFUSAL}.`,
    { cause: error },
  );
}

interface Batch {
  readonly files: Set<string>;
  readonly done: Promise<void>;
  readonly settle: () => void;
  readonly refuse: (error: unknown) => void;
}

function batch(): Batch {
  let settle: () => void = () => undefined;
  let refuse: (error: unknown) => void = () => undefined;
  const done = new Promise<void>((resolve, reject) => {
    settle = resolve;
    refuse = reject;
  });
  return { files: new Set(), done, settle, refuse };
}

/**
 * The work tree's root, which `--include` patterns are relative to.
 *
 * Asked once, on the first pointer, and resolved through `realpath` like the
 * files it is compared with: git reports the resolved path, and a baseline root
 * reached through a symlink — `/tmp` on macOS is one — would otherwise sit
 * outside it.
 */
async function locate(cwd: string, run: CommandRunner): Promise<string> {
  const result = await ran(run, ['rev-parse', '--show-toplevel'], cwd);
  if (result.code !== 0) {
    throw new RasterStoreError(
      `a baseline in ${cwd} is a git-LFS pointer, and \`git rev-parse --show-toplevel\` ` +
        `exited ${result.code} (${firstLine(result.stderr)}), so there is no work tree to ` +
        `fetch its image into. ${REFUSAL}.`,
    );
  }
  return realpath(result.stdout.trim());
}

/**
 * A file's path as a `--include` pattern matches it, and nothing else.
 *
 * git-lfs reads the list as gitignore patterns separated by commas. `[`, `]`,
 * `*`, `?` and `\` are special anywhere and a backslash makes each literal. `!`
 * and `#` are special only at the start, and escaped anywhere else git-lfs 3.7
 * matches nothing. A comma cannot be escaped, so it is answered by `?`, which
 * matches the comma and any file that differs from this one there alone — at
 * worst an extra image fetched, never one missed.
 */
function patternFor(toplevel: string, file: string): string {
  return relative(toplevel, file)
    .split(sep)
    .join('/')
    .replace(/[[\]*?\\]/g, '\\$&')
    .replace(/^[!#]/, '\\$&')
    .replaceAll(',', '?');
}

/** The patterns, joined into `--include` values that each fit the budget. */
function* chunked(patterns: readonly string[]): Generator<string> {
  let current: string[] = [];
  let length = 0;
  for (const pattern of patterns) {
    if (current.length > 0 && length + pattern.length + 1 > INCLUDE_BUDGET) {
      yield current.join(',');
      current = [];
      length = 0;
    }
    current.push(pattern);
    length += pattern.length + 1;
  }
  if (current.length > 0) yield current.join(',');
}

async function pullOnce(cwd: string, run: CommandRunner, include: string): Promise<void> {
  const result = await ran(run, ['lfs', 'pull', `--include=${include}`], cwd);
  if (result.code === 0) return;
  throw new RasterStoreError(
    `a baseline image is a git-LFS pointer, and \`git lfs pull --include=${include}\` exited ` +
      `${result.code} (${firstLine(result.stderr)}). The image was not fetched, so there is ` +
      `nothing to compare against. ${REFUSAL}.`,
  );
}

/** A run that could not spawn is a refusal too, naming the missing tool. */
async function ran(run: CommandRunner, args: readonly string[], cwd: string) {
  try {
    return await run('git', args, { cwd });
  } catch (error) {
    throw new RasterStoreError(
      `a baseline image in ${cwd} is a git-LFS pointer, and git could not be run to fetch ` +
        `it (${messageOf(error)}). ${REFUSAL}.`,
      { cause: error },
    );
  }
}

export function firstLine(text: string): string {
  return text.trim().split('\n')[0] ?? '';
}
