/**
 * A path a person asks about, read the way the recording spells its rows —
 * repository-relative, with `/` — and what git says about it in the checkout.
 *
 * A question may name a file through `..`, from the file system's root, or from
 * outside the checkout altogether. Resolving it here is what lets every answer
 * name the file the recording names, and lets a path outside the checkout be
 * refused as one rather than with whatever git printed about it.
 */

// compass: variance-authority.reach.relations

import { execFileSync } from 'node:child_process';
import { isAbsolute, relative, resolve, sep } from 'node:path';

/** The repository-relative spelling of `asked`, or why it has none. */
export type CheckoutPath = { readonly path: string } | { readonly outside: string };

/**
 * `asked`, resolved against `root` and spelled from it with `/`. A path that
 * resolves outside `root` is answered with the sentence that says so.
 */
export function checkoutPath(root: string, asked: string): CheckoutPath {
  const from = relative(resolve(root), resolve(root, asked));
  if (from === '..' || from.startsWith(`..${sep}`) || isAbsolute(from)) {
    return { outside: `${asked} is outside the checkout at ${root}, and the recording holds only paths inside it.` };
  }
  return { path: from === '' ? '.' : from.split(sep).join('/') };
}

/**
 * What git lists at a path in the checkout: the file itself, files under it,
 * which makes it a directory, or neither and on disk but ignored. Asked once
 * per question and carried to every reader that needs it.
 */
export type CheckoutListing =
  | { readonly file: boolean; readonly directory: boolean; readonly ignored: boolean }
  | { readonly unread: string };

/** What git lists at `path`, a repository-relative path, in the checkout at `root`. */
export function checkoutListing(root: string, path: string): CheckoutListing {
  const listed = gitNames(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', path]);
  if ('unread' in listed) return listed;
  if (listed.length > 0) {
    const file = listed.includes(path);
    return { file, directory: !file, ignored: false };
  }
  const ignored = gitNames(root, ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory', '--', path]);
  if ('unread' in ignored) return ignored;
  return { file: false, directory: false, ignored: ignored.length > 0 };
}

/**
 * Whether `path`, a repository-relative path, existed at `commit`: git lists
 * something there in that commit's tree. A recording made at a commit that did
 * not hold the file keeps no row for it, and that is a file added since, not a
 * file no test loaded. Answered with the first line git gave when it could not
 * list the commit.
 */
export function existedAt(root: string, commit: string, path: string): boolean | { readonly unread: string } {
  const held = existingAt(root, commit, [path]);
  return 'unread' in held ? held : held.size > 0;
}

/** The most bytes of path one listing carries: under every platform's limit on a command line. */
const LISTED_BYTES = 24 * 1024;

/**
 * Which of `paths` `commit` held, as {@link existedAt} answers one, in one
 * listing for as many paths as a command line carries. It reads trees alone, so
 * a blob a partial clone left behind is no fetch and a submodule is held,
 * which `blobsAt` names no object for, so it would answer one absent.
 */
export function existingAt(root: string, commit: string, paths: readonly string[]): ReadonlySet<string> | { readonly unread: string } {
  const held = new Set<string>();
  for (const batch of batchesOf(paths)) {
    const listed = gitNames(root, ['ls-tree', '-z', '--name-only', commit, '--', ...batch]);
    if ('unread' in listed) return listed;
    for (const name of listed) held.add(name);
  }
  return held;
}

function batchesOf(paths: readonly string[]): readonly (readonly string[])[] {
  const batches: string[][] = [];
  let bytes = LISTED_BYTES;
  for (const path of paths) {
    const size = Buffer.byteLength(path) + 1;
    if (bytes + size > LISTED_BYTES) {
      batches.push([]);
      bytes = 0;
    }
    batches[batches.length - 1]!.push(path);
    bytes += size;
  }
  return batches;
}

/** The names a git listing gives, or the first line git gave for not answering. */
function gitNames(root: string, args: readonly string[]): readonly string[] | { readonly unread: string } {
  try {
    const listed = execFileSync('git', ['--literal-pathspecs', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return listed.split('\0').filter((name) => name !== '');
  } catch (error) {
    const said = error instanceof Error && 'stderr' in error ? String(error.stderr) : String(error);
    return { unread: said.trim().split('\n')[0] || `git could not list ${path(args)}` };
  }
}

function path(args: readonly string[]): string {
  return args[args.length - 1] ?? '';
}
