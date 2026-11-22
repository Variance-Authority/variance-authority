/**
 * What a module's probes mean, and the journals that report which ones fired.
 *
 * A probe in a realm the recorder does not own can only report an ordinal and
 * the module it belongs to. What an ordinal *is* — a name, a span of lines, a
 * digest — is not carried anywhere: placing probes is deterministic, so the
 * join cuts the module again from the file it was cut from
 * ([`captured-modules.ts`](./captured-modules.ts)) and reads the ordinal there.
 */

import { readFile, readdir } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import type { ModuleId } from '../instrument/index.js';
import type { CoverageBlock } from './index.js';

/**
 * Where a module's probes go, on every seam that places them.
 *
 * `after-transforms`, the default, places them in what the project's
 * transforms wrote, through the map back to the file, so a compiler that reads
 * syntax never reads a probe. `before-transforms` places them in the file as
 * read, ahead of every transform: one parse and no map, for a run whose
 * transforms only strip types or JSX. A compiler that reads syntax, such as
 * Compiled or the React Compiler, then reads the probes too.
 */
export type ProbePlacement = 'after-transforms' | 'before-transforms';

/** One module the transform saw, whether or not it could read it. */
export interface CapturedModule {
  /** Repository-relative, forward-slashed: the same path a coverage row carries. */
  readonly file: string;
  /** What the probes report: the path of the file they were placed in and the digest of its text, `path@digest`. */
  readonly id: ModuleId;
  readonly sourceDigest: string;
  /** False records module-level unknown evidence; consumers widen without consulting blocks. */
  readonly instrumented: boolean;
  readonly blocks: readonly CoverageBlock[];
}

/** Strip a bundler's query suffix: `Button.tsx?v=1` is `Button.tsx`. */
export function cleanId(id: string): string {
  return id.split('?')[0] ?? id;
}

/**
 * Product source, as every runner seam defaults to reading it.
 *
 * A `*.config.[cm]?[jt]s` file is read by a loader rather than by the test
 * environment, so the setup shim that installs the probe log has never run
 * where one evaluates: instrumented, its first probe throws and takes the run
 * with it. The precise exclusion is the resolved config's own `globalSetup` list
 * (`vitest.ts`); this is the backstop for what no config names, itself first.
 */
export function defaultInclude(file: string): boolean {
  return (
    isAbsolute(file) &&
    /\.[cm]?[jt]sx?$/.test(file) &&
    !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file) &&
    !/\.config\.[cm]?[jt]s$/.test(basename(file)) &&
    !file.split(sep).includes('node_modules') &&
    !file.split(sep).includes('dist')
  );
}

export function projectPath(root: string, file: string): string {
  return relative(root, file).split(sep).join('/');
}

/** Whether the absolute `file` lies under `root`, so {@link projectPath} names it without leaving the checkout. */
export function insideRoot(root: string, file: string): boolean {
  const path = relative(root, file);
  return path !== '' && !path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path);
}

/** What one test file's run counted, per module, under the ids the modules reported. */
export interface ReadJournal {
  readonly testFile: string;
  /** When the file finished collecting, by the worker's `Date.now()`; absent where nothing marked it. */
  readonly collected?: number;
  readonly modules: ReadonlyArray<{
    readonly id: ModuleId;
    readonly hits: readonly number[];
    /** Entered while the module was evaluating: every file that consumed the module owns it. */
    readonly shared: readonly number[];
    /** Entered before the file's first test ran: a consequence of loading, not of a test. */
    readonly loaded: readonly number[];
    /** The test line each of `hits` was first reached under, one to one; absent where the case was not cut. */
    readonly lines?: readonly number[];
  }>;
}

/**
 * Every file in a directory, as its bytes, ordered by what they hold; nothing
 * where there is no directory.
 *
 * What concurrent processes wrote carries no order of its own — no clock
 * orders two workers the same way twice — and a reader that folds it sums,
 * joins and lists in the order it reads. Its bytes are the one order that is
 * the same in every run that wrote the same things.
 */
export async function readWritten(directory: string): Promise<readonly Buffer[]> {
  return (await readNamed(directory)).map((written) => written.bytes);
}

/** {@link readWritten}, with the name each file was written under. */
export async function readNamed(directory: string): Promise<ReadonlyArray<{ name: string; bytes: Buffer }>> {
  let names: readonly string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  const written = await Promise.all(names.map(async (name) => ({ name, bytes: await readFile(resolve(directory, name)) })));
  return written.sort((left, right) => Buffer.compare(left.bytes, right.bytes));
}

export function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/**
 * The file on disk, or nothing where no file holds the module: a bundler's
 * virtual module, named by no absolute path or by one with `\0` in it, or a
 * path nothing is at. A file that is there and cannot be read fails, with
 * its reason: the probes would otherwise take it for a module no file holds.
 */
export function fileOrNone(path: string, read: (path: string) => string): string | undefined {
  if (!isAbsolute(path) || path.includes('\0')) return undefined;
  try {
    return read(path);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw new Error(`\`${path}\`: the probes cannot read the file to place its regions: ${(error as Error).message}`, { cause: error });
  }
}

export const NODE_MODULES = /[/\\]node_modules[/\\]/;

/**
 * Whether a module could be taken before its file is read. A file under
 * `node_modules` is taken under its own name alone, as no map there is read,
 * so `accepts` answers for it unread. Any other file may name a map whose
 * source `accepts` takes, which only its text says.
 */
export function mayTake(file: string, accepts: (file: string) => boolean): boolean {
  return !NODE_MODULES.test(file) || accepts(file);
}
