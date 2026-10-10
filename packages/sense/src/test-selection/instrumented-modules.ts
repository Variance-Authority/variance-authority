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

export type { ModuleId };

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

/** What one test file's run counted, per module, under the ids the modules reported. */
export interface ReadJournal {
  readonly testFile: string;
  readonly modules: ReadonlyArray<{
    readonly id: ModuleId;
    readonly hits: readonly number[];
    /** Entered while the module was evaluating: every file that consumed the module owns it. */
    readonly shared: readonly number[];
    /** Entered before the file's first test ran: a consequence of loading, not of a test. */
    readonly loaded: readonly number[];
  }>;
}

/** The ordinals of one journal row a fold reads: what the file hit, or what it had hit before its first test. */
export type JournalOrdinals = (module: ReadJournal['modules'][number]) => readonly number[];

/**
 * Which test files crossed each ordinal of each module, folded from every
 * journal of one run.
 *
 * An ordinal a file hit on its own is that file's. An ordinal hit while the
 * module was evaluating is every file's that consumed the module: a worker
 * that keeps its module graph between files evaluates a module once, in
 * whichever file's window came first, and every later file that entered the
 * module read what that evaluation made. A file that never entered the module
 * did not consume it, and under isolation — where each file evaluates the
 * module itself and holds its own window — that is every other file in the
 * run. Crediting them would put a top-level edit in front of the whole suite.
 *
 * `ordinalsOf` picks which ordinals of a row are folded. The default is what
 * the file entered; {@link loadedOf} folds what it had entered before its
 * first test under the same crediting, because what a module did while
 * evaluating happened before the first test of every file that consumed it.
 */
export function crossingsOf(
  journals: readonly ReadJournal[],
  ordinalsOf: JournalOrdinals = (module) => module.hits,
): ReadonlyMap<ModuleId, ReadonlyMap<number, ReadonlySet<string>>> {
  const consumers = new Map<ModuleId, Set<string>>();
  for (const journal of journals) {
    for (const module of journal.modules) {
      const holders = consumers.get(module.id) ?? new Set<string>();
      holders.add(journal.testFile);
      consumers.set(module.id, holders);
    }
  }
  const observed = new Map<ModuleId, Map<number, Set<string>>>();
  for (const journal of journals) {
    for (const module of journal.modules) {
      const byOrdinal = observed.get(module.id) ?? new Map<number, Set<string>>();
      const shared = new Set(module.shared);
      for (const ordinal of ordinalsOf(module)) {
        const tests = byOrdinal.get(ordinal) ?? new Set<string>();
        if (shared.has(ordinal)) for (const test of consumers.get(module.id)!) tests.add(test);
        else tests.add(journal.testFile);
        byOrdinal.set(ordinal, tests);
      }
      observed.set(module.id, byOrdinal);
    }
  }
  return observed;
}

/** Which test files each ordinal had been entered for before their first test ran. */
export function loadedOf(
  journals: readonly ReadJournal[],
): ReadonlyMap<ModuleId, ReadonlyMap<number, ReadonlySet<string>>> {
  return crossingsOf(journals, (module) => module.loaded);
}

export function codeUnitOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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
