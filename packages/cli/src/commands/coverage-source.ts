// compass: variance-authority.reach.crossings
/**
 * The source `variance coverage` counts over, including the files no suite recorded.
 *
 * A record holds only the modules some suite loaded, so a file nothing loaded is
 * in no record, and a ratio over the records alone can be 100% over an
 * application half of whose files never ran. The source index holds every file,
 * with the size its parse stored ([`source-scope.ts`](../../../sense/src/source-scope.ts)),
 * so the files in scope that no suite recorded are listed here with their lines
 * and the regions the instrument would cut from them, and the ratio is printed
 * a second time over those regions too.
 *
 * *Recorded*, not *loaded*: a seam can load a module it leaves uninstrumented —
 * this repository's own probe runtime is one ([`tools/page-side.mjs`](../../../../tools/page-side.mjs)) —
 * and the record cannot tell that module from one nothing imported.
 *
 * Which files are in scope is `--from`'s: what the directory's declared entry
 * points reach, or every file under it, or every file the index holds.
 *
 * A file the harness loads is not one nothing loaded. Every recording names
 * what each test rests on besides the modules it instrumented — the runner's
 * config and the local modules that config imports — and what those reach along
 * the imports is before reach ([`before.ts`](../../../core/src/relate/before.ts)):
 * it ran under every test, and no test's record holds a region of it. Before
 * reach is counted per scope: only the files of it that the scope's own entry
 * points reach, so the runner's config, which no application imports, is in
 * none. Its regions count as run in the ratio over the source, and the ratio
 * says what share of the run they are, because a region run only before reach
 * is run without a test aimed at it — which is how most of a harness is tested.
 *
 * Without `--from`, each directory the root config declares entry points for is
 * counted on its own, so a monorepo reads one line per application, and the
 * source is what those entry points reach together: a file none of them reaches
 * is not counted anywhere. `--packages` counts every package the same way, as
 * the package graph names them ([`orient.ts`](../../../sense/src/orient.ts)),
 * less every one the root manifest's `workspaces` leaves out: a named manifest
 * under a test's fixtures is a package to the graph and not one of this
 * repository's. Each is counted twice — its own files, and
 * everything it reaches along its imports.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isCI } from 'ci-info';
import {
  declaredEntrypoints,
  defaultInclude,
  type ExecutionIndex,
} from '@variance-authority/sense/test-selection';
import type { FileSize, SourceScope } from '@variance-authority/sense';
import { beforeReach, relationsOfFiles, type FileRecord } from '@variance-authority/core/relate';
import { messageOf } from '../config-values.js';
import { OperatorError } from '../exit.js';

/** Files in scope that no suite recorded, added up, and each one. */
export interface Unloaded {
  readonly files: number;
  readonly lines: number;
  readonly bytes: number;
  /** Regions the instrument would cut from them. */
  readonly regions: number;
  /** Of `files`, those whose parse had a diagnostic, so no region count. */
  readonly uncut: number;
  /** Per directory, most regions first. */
  readonly directories: readonly { readonly directory: string; readonly files: number; readonly lines: number; readonly regions: number }[];
  /** Sorted by path. */
  readonly list: readonly FileSize[];
}

/** The source in scope, as the index holds it. */
export interface CoverageSource {
  /** The directory `--from` named. Absent for every file the index holds. */
  readonly from?: string;
  readonly seeds: SourceScope['seeds'];
  /** Declared entry-point patterns that matched no file. */
  readonly unmatched?: readonly string[];
  /** Product source files in scope: not tests, not configs, not declarations. */
  readonly files: number;
  /** Files in scope no suite recorded and the harness loads. Absent when no record names a harness. */
  readonly before?: Unloaded;
  readonly unloaded: Unloaded;
  /** Regions run in scope: the ones a suite ran, and every region before reach. */
  readonly ran: number;
  /** Regions in scope: the ones the suites loaded, before reach, and in files nothing recorded. */
  readonly regions: number;
}

/** One directory counted on its own: its own files, and everything they reach. */
export interface EntryReading {
  readonly from: string;
  readonly own: Scoped;
  readonly uses: Scoped;
}

/** A directory with declared entry points that the index holds nothing under. */
export interface MissedEntry {
  readonly from: string;
  readonly missed: string;
}

/** One part of the repository and the sizes of its product source. */
export interface Scoped {
  /** The files `--from` reaches. Absent without `--from`: every record is in scope. */
  readonly scope?: ReadonlySet<string>;
  readonly from?: string;
  readonly seeds: SourceScope['seeds'];
  readonly unmatched?: readonly string[];
  /** Every product source file in scope, with its size. */
  readonly sizes: readonly FileSize[];
}

/** The files in scope and their sizes, or why the index could not say. */
export type SourceReading =
  | (Scoped & {
      /** What the index holds, for the walk from what the harness loads. */
      readonly records: readonly FileRecord[];
      /** Each package, or each directory with declared entry points, when `--from` named none. */
      readonly entries?: readonly (EntryReading | MissedEntry)[];
    })
  | { readonly missed: string };

/** Read the published source index and the scope `from` names in it. */
export async function readSource(root: string, from: string | undefined, packages = false): Promise<SourceReading> {
  const sense = await import('@variance-authority/sense');
  let published;
  try {
    published = await sense.publishedSources(root, {
      ci: isCI,
      step: 'variance index',
      announce: (line) => process.stderr.write(`variance: ${line}\n`),
    });
  } catch (error) {
    // The ratio over what the suites loaded is still true without the index.
    if (error instanceof sense.SourceIndexUnpublished) return { missed: error.message };
    throw error;
  }
  const entrypoints = declaredEntrypoints(root);
  const scoped = (dir: string | undefined): Scoped => {
    const scope = sense.sourceScope(published.records, dir, entrypoints);
    const product = scope.files.filter((file) => productSource(root, file));
    return {
      ...(dir === undefined ? {} : { scope: new Set(scope.files) }),
      ...(scope.from === undefined ? {} : { from: scope.from }),
      seeds: scope.seeds,
      ...(scope.unmatched === undefined || scope.unmatched.length === 0 ? {} : { unmatched: scope.unmatched }),
      sizes: sense.fileSizes(published.records, published.cache, product),
    };
  };
  const declared = from === undefined && entrypoints !== undefined ? [...entrypoints.keys()].sort() : [];
  const dirs = packages ? packageDirectories(sense, root, published.records) : declared;
  const entries = dirs.map((dir): EntryReading | MissedEntry => {
    try {
      const uses = scoped(dir);
      const at = `${dir}/`;
      return {
        from: dir,
        own: { ...uses, scope: new Set([...uses.scope!].filter((file) => file.startsWith(at))), sizes: uses.sizes.filter((size) => size.file.startsWith(at)) },
        uses,
      };
    } catch (error) {
      return { from: dir, missed: messageOf(error) };
    }
  }).filter((entry) => 'missed' in entry || entry.own.sizes.length > 0);
  const listed = dirs.length === 0 ? {} : { entries };
  if (declared.length === 0) {
    try {
      return { ...scoped(from), records: published.records, ...listed };
    } catch (error) {
      throw new OperatorError(messageOf(error), { cause: error });
    }
  }
  const scope = new Set(declared.flatMap((dir) => {
    try {
      return [...scoped(dir).scope!];
    } catch {
      return [];
    }
  }));
  const product = [...scope].sort().filter((file) => productSource(root, file));
  return {
    scope,
    seeds: 'entrypoints',
    sizes: sense.fileSizes(published.records, published.cache, product),
    records: published.records,
    ...listed,
  };
}

/**
 * Every package directory the package graph puts a file the index holds in,
 * but the root's, and within the root manifest's `workspaces` when it has them.
 */
function packageDirectories(sense: typeof import('@variance-authority/sense'), root: string, records: readonly FileRecord[]): readonly string[] {
  const around = sense.packagesAround(root, records.map((record) => record.file), { rows: 0, names: 0 });
  if (around.orientation === undefined) throw new OperatorError(`\`--packages\` reads the package graph, and no source index is published at ${around.index}`);
  const workspaces = workspacesOf(root);
  const dirs = new Set(around.orientation.owners.map((owner) => owner.directory ?? '')
    .filter((dir) => dir !== '' && (workspaces === undefined || workspaces.some((pattern) => sense.matchesGlob(pattern, dir)))));
  return [...dirs].sort();
}

// TODO: a pnpm repository names its workspaces in `pnpm-workspace.yaml`, which
// is not read here, so every named manifest the graph finds is a package.
function workspacesOf(root: string): readonly string[] | undefined {
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  } catch {
    return undefined;
  }
  const declared = (manifest as { workspaces?: unknown } | null)?.workspaces;
  const list = Array.isArray(declared) ? declared : (declared as { packages?: unknown } | undefined)?.packages;
  return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string').map((item) => item.replace(/^\.\//u, '').replace(/\/$/u, '')) : undefined;
}

/**
 * What `harness` reaches along the imports, or nothing when no record names a
 * harness the index holds. The walk starts outside every scope — at the
 * runner's config — and each scope counts only the part of it it holds.
 */
export function harnessReach(records: readonly FileRecord[], harness: readonly string[]): ReadonlySet<string> | undefined {
  if (harness.length === 0) return undefined;
  const reached = beforeReach(relationsOfFiles(records), harness);
  return harness.every((entry) => reached.unread.includes(entry)) ? undefined : reached.files;
}

/**
 * The source in scope, less every file some counted record loaded, with what
 * the harness reaches told apart from what nothing loaded. `count` is the count
 * over the same records, narrowed to the same scope.
 */
export function coverageSource(
  reading: Scoped,
  indexes: readonly ExecutionIndex[],
  count: { readonly run: number; readonly regions: number },
  reach: ReadonlySet<string> | undefined,
): CoverageSource {
  const loaded = new Set(indexes.flatMap((index) => index.modules.map((module) => module.file)));
  const unrecorded = reading.sizes.filter((size) => !loaded.has(size.file));
  const before = reach === undefined ? undefined : summed(unrecorded.filter((size) => reach.has(size.file)));
  const unloaded = summed(unrecorded.filter((size) => !reach?.has(size.file)));
  const beforeRegions = before?.regions ?? 0;
  return {
    ...(reading.from === undefined ? {} : { from: reading.from }),
    seeds: reading.seeds,
    ...(reading.unmatched === undefined ? {} : { unmatched: reading.unmatched }),
    files: reading.sizes.length,
    ...(before === undefined ? {} : { before }),
    unloaded,
    ran: count.run + beforeRegions,
    regions: count.regions + beforeRegions + unloaded.regions,
  };
}

/** The index with only the modules `scope` holds. Unchanged when there is no scope. */
export function within(index: ExecutionIndex, scope: ReadonlySet<string> | undefined): ExecutionIndex {
  return scope === undefined ? index : { ...index, modules: index.modules.filter((module) => scope.has(module.file)) };
}

/**
 * What a runner seam instruments by default, and what no runner loads: a
 * declaration file has no code to run.
 */
// TODO: this is `defaultInclude`, a guess at every seam's include and exclude
// patterns; a seam that published which files it instruments would make the
// guess an answer, and would tell a file it chose not to instrument from one
// nothing loaded.
function productSource(root: string, file: string): boolean {
  return defaultInclude(join(root, file)) && !/\.d\.[cm]?ts$/u.test(file);
}

function summed(list: readonly FileSize[]): Unloaded {
  const directories = new Map<string, { directory: string; files: number; lines: number; regions: number }>();
  let lines = 0;
  let bytes = 0;
  let regions = 0;
  let uncut = 0;
  for (const size of list) {
    lines += size.lines;
    bytes += size.bytes;
    if (size.blocks === undefined) uncut += 1;
    else regions += size.blocks;
    const directory = size.file.includes('/') ? size.file.slice(0, size.file.lastIndexOf('/')) : '.';
    let row = directories.get(directory);
    if (row === undefined) directories.set(directory, (row = { directory, files: 0, lines: 0, regions: 0 }));
    row.files += 1;
    row.lines += size.lines;
    row.regions += size.blocks ?? 0;
  }
  return {
    files: list.length,
    lines,
    bytes,
    regions,
    uncut,
    directories: [...directories.values()].sort((a, b) =>
      b.regions - a.regions || (a.directory < b.directory ? -1 : a.directory > b.directory ? 1 : 0)),
    list: [...list].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0)),
  };
}
