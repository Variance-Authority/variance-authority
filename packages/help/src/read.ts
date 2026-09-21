/**
 * What the repository imports and exports, read from the index the scan keeps.
 *
 * [`use.ts`](../../package/src/use.ts) can answer this by itself: walk every
 * directory, parse every module, collect every specifier. On this repository
 * that is 1336 files and about half a second, and the half second is paid again
 * on the next question about the same unchanged checkout. A repository ten times
 * the size — which is an ordinary repository — pays ten times that, every time,
 * to re-learn a tree where almost nothing moved.
 *
 * Nothing about the reading justifies the cost, because the reading is already
 * done. [`sense`](../../sense) keeps a durable, content-keyed index of exactly
 * these bytes: git names each file's content without opening it, the digest
 * names what parsing that content produced, and a scan of an unchanged tree
 * costs a map lookup per file. What was missing was not a cache but a door —
 * `ScanOptions.parsed` hands each file's parse out as the scan settles it, so a
 * second reading of the same bytes joins the first instead of repeating it.
 *
 * ## Two readings, one index
 *
 * The scan's own question is which files reach which files. This question is
 * which *names* one package takes from another and which names each file hands
 * out, and the specifiers it needs are the same specifiers the scan resolved.
 * Sharing the index means the answer gets faster every time anything else in the
 * toolchain scans — and it means a repository that has never run a selection
 * still pays the full walk exactly once.
 *
 * Both halves of a file's parse are read, not just the requests. The exports are
 * what makes a name findable when no manifest publishes it, which is most of the
 * code in any checkout, and they cost nothing extra: the same cached parse that
 * already said what the file imports also says what it exports.
 */

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { treeOf, type FileRecord, type Tree } from '@variance-authority/mcp/tools';
import {
  enrichSources,
  openSourceIndex,
  scanRelations,
  sourceIndexPath,
  type ParseCache,
  type Parsed,
} from '@variance-authority/sense';
import { NAMESPACE_NAME } from '@variance-authority/sense/read';
import { taintRecords, type Taint } from '@variance-authority/sense/taint';
import {
  assembleHelp,
  kindOf,
  ownership,
  readOfferings,
  requested,
  type Deep,
  type Help,
  type HelpOptions,
  type Named,
  type Offering,
  type Usage,
  type Use,
} from '@variance-authority/package/help';
import { indexedNames, type IndexedSource } from './indexed-surface.js';
import {
  readWorkspaceSnapshot,
  tryPublishWorkspaceSnapshot,
  workspaceGeneration,
} from './snapshot.js';

export { readWorkspaceSnapshot, workspaceGeneration, workspaceSnapshotPath } from './snapshot.js';
export type { SnapshotOptions } from './snapshot.js';

export interface ReadingOptions extends HelpOptions, IndexedUsageOptions {}

export interface AnsweringOptions extends ReadingOptions {
  /** Read the published generation regardless of age and perform no refresh. */
  readonly justAnswer?: boolean;
  /** Refresh a published generation older than this. Defaults to one hour. */
  readonly refreshAfterMs?: number;
}

/**
 * Answer from the published value while it is young enough, or refresh it when
 * the caller permits. `justAnswer` is the hard no-I/O-beyond-the-artifact path.
 */
export async function readWorkspaceForAnswer(
  root: string,
  options: AnsweringOptions = {},
): Promise<Help> {
  const {
    justAnswer = false,
    refreshAfterMs = 60 * 60 * 1000,
    ...reading
  } = options;
  if (!Number.isFinite(refreshAfterMs) || refreshAfterMs < 0) {
    throw new Error('refreshAfterMs must be a finite, non-negative number');
  }
  if (justAnswer && (reading.changed !== undefined || reading.taints !== undefined)) {
    throw new Error('justAnswer cannot be combined with changed paths or taints, which request a refresh');
  }

  let recorded: Help;
  try {
    recorded = await readWorkspaceSnapshot(root, reading);
  } catch (error) {
    if (justAnswer) throw error;
    return readWorkspace(root, reading);
  }

  const at = workspaceGeneration(recorded);
  const age = at === undefined ? Number.POSITIVE_INFINITY : Date.now() - Date.parse(at);
  if (justAnswer || (reading.changed === undefined && reading.taints === undefined && age <= refreshAfterMs)) {
    return recorded;
  }
  if (reading.changed !== undefined || reading.taints !== undefined) {
    return refreshWorkspace(root, recorded, reading);
  }
  return readWorkspace(root, reading);
}

export interface IndexedUsageOptions {
  /** Where the index is kept. The checkout's own cache layer when absent. */
  readonly index?: string;
  /** Whether to publish what this scan learned. On, because the next question is the point. */
  readonly save?: boolean;
  /**
   * Authoritative changed file paths, relative to the scan root.
   * Present skips Git status discovery; renames name both paths.
   */
  readonly changed?: readonly string[];
  /**
   * Additional declarative module loads to join onto the graph used by path
   * questions.
   *
   * These do not manufacture symbol bindings: usage counts remain facts from
   * ordinary imports inside the files the additional edge makes reachable.
   * Subtractive taints are refused because a mock is relative to one file's
   * run and cannot be flattened into the workspace-wide source tree.
   */
  readonly taints?: readonly Taint[];
  /**
   * Handed the arrows the scan drew, for a caller that needs the graph as well
   * as the names.
   *
   * The scan walks the whole checkout and returns the import graph whichever
   * question asked for it; this reading wanted only the half that says which
   * names each file takes and hands out, and threw the other half away. A
   * caller that has to answer *which files does this path reach* would then
   * scan the repository a second time to learn something the first scan had
   * already worked out and dropped on the floor.
   *
   * So it is a door rather than a return value, for the same reason
   * `ScanOptions.parsed` is one: the reading that wants it is not the reading
   * this function performs, and a caller that does not want it should not be
   * handed a graph it has to ignore.
   */
  readonly records?: (records: readonly FileRecord[], graphRoot: string) => void;
  /** Handed the queryable graph when a caller asks a path-shaped question. */
  readonly tree?: (tree: Tree) => void;
}

/** Join cached parse facts directly, without constructing a second repository. */
function collectingUsage(opened: ReadonlySet<string>): {
  accept(at: string, by: string, parsed: Parsed): void;
  read(): Usage;
} {
  const packages = new Set([...opened].map((key) => key.slice(0, key.indexOf(' '))));
  const names = new Map<string, Map<string, Use[]>>();
  const deep: Deep[] = [];
  const exported: Named[] = [];
  const unreadable: string[] = [];

  return {
    accept(at, by, parsed) {
      if (parsed.unknown !== undefined) unreadable.push(at);
      const kind = kindOf(at);

      for (const published of parsed.exports ?? []) {
        if (published.exported !== undefined) {
          exported.push({
            name: published.exported,
            at,
            by,
            line: published.line,
            type: published.type,
            kind,
          });
        }
      }

      for (const asked of parsed.requests) {
        const key = requested(asked.value);
        if (!packages.has(key.slice(0, key.indexOf(' ')))) continue;
        if (!opened.has(key)) {
          deep.push({ specifier: asked.value, by, at, line: asked.line });
          continue;
        }

        const held = names.get(key) ?? new Map<string, Use[]>();
        names.set(key, held);
        for (const binding of asked.bindings) {
          if (binding.imported === NAMESPACE_NAME) continue;
          const uses = held.get(binding.imported) ?? [];
          held.set(binding.imported, uses);
          uses.push({ by, at, line: binding.line, type: binding.type, kind });
        }
      }
    },
    read: () => ({ names, deep, exported, unreadable }),
  };
}

/**
 * Read what a repository imports from what it publishes, out of the source index.
 *
 * `opened` is every `<package> <subpath>` the manifests answer, exactly as
 * [`readUsage`](../../package/src/use.ts) takes it: the package half says which
 * specifiers are worth following, and the whole key says which of them came
 * through a published door.
 */
export async function readIndexedUsage(
  root: string,
  opened: ReadonlySet<string>,
  options: IndexedUsageOptions = {},
): Promise<Usage> {
  const scanned = await scanIndexed(root, opened, options);
  if (options.save !== false) await scanned.save();
  return scanned.usage;
}

async function scanIndexed(
  root: string,
  opened: ReadonlySet<string>,
  options: IndexedUsageOptions,
  dirs: readonly string[] = ['.'],
): Promise<{
  readonly usage: Usage;
  readonly sources: Map<string, IndexedSource>;
  readonly records: readonly FileRecord[];
  readonly cache: ParseCache;
  save(): Promise<void>;
}> {
  const where = resolve(root);
  const index = await openSourceIndex(options.index ?? sourceIndexPath(where));
  const owner = ownership(where);
  const usage = collectingUsage(opened);
  const sources = new Map<string, IndexedSource>();

  const records = await scanRelations({
    // The whole checkout, not the workspace members. A repository holds source
    // that no `workspaces` entry claims — `tools/`, a scripts directory, a
    // config that imports from a package — and that source imports these
    // packages like anything else does. The scan declines to descend into a
    // checkout that is not this one, so the root means this repository.
    root: where,
    dirs,
    cache: index.cache,
    reuse: index.reuse,
    ...(options.changed === undefined ? {} : { changed: options.changed }),
    parsed: (file, parsed) => {
      usage.accept(file, owner(file), parsed);
    },
    indexed: (file, parsed, targets) => {
      sources.set(file, { parsed, targets });
    },
  });
  const tainted = await taintRecords(records, options.taints ?? [], { root: where, cache: index.cache });
  if (tainted.shadows.size > 0) {
    throw new Error(
      `Help source areas cannot apply subtractive taints: ${tainted.shadows.size} file(s) shadow a module. ` +
      'Pass addition-only taints for declarative module loads.',
    );
  }
  options.records?.(tainted.records, where);
  options.tree?.(treeOf(tainted.records, where));

  const joined = usage.read();
  const recordUnknown = records.flatMap((record) => record.unknown === undefined ? [] : [record.unknown]);
  return {
    usage: recordUnknown.length === 0
      ? joined
      : { ...joined, unreadable: [...joined.unreadable, ...recordUnknown] },
    sources,
    records: tainted.records,
    cache: index.cache,
    save: () => index.save(),
  };
}

/**
 * A workspace, read with the index doing the expensive third of the work.
 *
 * The same value [`readHelp`](../../package/src/help.ts) returns and the same
 * reading behind it — the manifests say which doors exist, the source behind
 * them says what is on the other side, and the repository says what it reaches
 * for. Only the third one changes: it comes from the source index rather than
 * from a walk, so asking a second question about an unchanged checkout costs the
 * manifests and nothing else.
 *
 * Asynchronous because the index is a file. That is the whole of the difference
 * at the call site, and it is why the synchronous door is still there: a caller
 * with no cache directory to write to, or one reading a tree it does not own,
 * wants `readHelp` and should keep having it.
 */
export async function readWorkspace(root: string, options: ReadingOptions = {}): Promise<Help> {
  const read = await scanWorkspace(root, options);
  return documentWorkspace(read, options);
}

/**
 * Refresh volatile source facts while retaining a previously documented surface.
 *
 * Usage, exported names, unreadable files and the graph are always taken from
 * the new Sense scan. Signatures, comments and README mentions stay on the
 * supplied reading until its published or exported name set changes; a new or
 * removed symbol therefore rebuilds documentation immediately rather than
 * waiting for the caller's slower documentation cadence.
 */
export async function refreshWorkspace(
  root: string,
  documented: Help,
  options: ReadingOptions = {},
): Promise<Help> {
  const read = await scanWorkspace(root, options);
  if (!sameSurface(read, documented)) return documentWorkspace(read, options);
  const help = joinUsage(documented, read.offerings, read.scanned.usage);
  if (options.save !== false) {
    await read.scanned.save();
    await tryPublishWorkspaceSnapshot(read.workspace, read.root, help, read.scanned.records, options.index);
  }
  return help;
}

interface WorkspaceScan {
  /** The workspace the caller asked to answer about. */
  readonly workspace: string;
  /** The repository root whose graph carries that workspace. */
  readonly root: string;
  readonly offerings: readonly Offering[];
  readonly scanned: Awaited<ReturnType<typeof scanIndexed>>;
  readonly changed?: readonly string[];
}

async function scanWorkspace(root: string, options: ReadingOptions): Promise<WorkspaceScan> {
  const where = resolve(root);
  const offerings = readOfferings(where, { ...options, tolerant: options.tolerant ?? true });
  const scope = scanScope(where, offerings);
  const opened = new Set(
    offerings.flatMap((offering) =>
      offering.entrypoints.map((entry) => `${offering.name} ${entry.subpath}`),
    ),
  );

  const scanned = await scanIndexed(scope.root, opened, options, scope.dirs);
  return {
    workspace: where,
    root: scope.root,
    offerings,
    scanned,
    ...(options.changed === undefined ? {} : { changed: options.changed }),
  };
}

async function documentWorkspace(read: WorkspaceScan, options: ReadingOptions): Promise<Help> {
  const { root, offerings, scanned } = read;
  const byFile = new Map(scanned.records.map((record) => [record.file, record]));
  const names = await indexedNames(root, offerings, scanned.sources, async (files) => {
    const subjects = files.flatMap((file) => {
      const digest = byFile.get(file)?.digest;
      return digest === undefined ? [] : [{ file, digest }];
    });
    return enrichSources(root, subjects, scanned.cache);
  });
  const help = assembleHelp(root, offerings, scanned.usage, names);
  if (options.save !== false) {
    await scanned.save();
    await tryPublishWorkspaceSnapshot(read.workspace, read.root, help, scanned.records, options.index);
  }
  return help;
}

function sameSurface(read: WorkspaceScan, documented: Help): boolean {
  const shape = read.offerings.map((offering) => ({
    name: offering.name,
    declared: offering.declared,
    openings: offering.entrypoints.map((entry) => ({
      subpath: entry.subpath,
      source: relative(read.root, entry.source),
    })),
  }));
  const previous = documented.packages.map((published) => ({
    name: published.name,
    declared: published.declared,
    openings: published.openings.map(({ subpath, source }) => ({ subpath, source })),
  }));
  return isDeepStrictEqual(shape, previous) && sameExportedSurface(read, documented);
}

function sameExportedSurface(read: WorkspaceScan, documented: Help): boolean {
  if (read.changed?.length === 0) return true;
  const changed = read.changed === undefined ? undefined : new Set(read.changed);
  const keys = (values: Help['exported']): Set<string> => new Set(
    values
      .filter((value) => changed === undefined || changed.has(value.at))
      .map((value) => `${value.at}\0${value.name}\0${value.kind}\0${Number(value.type)}`),
  );
  const before = keys(documented.exported);
  const after = keys(read.scanned.usage.exported);
  return before.size === after.size && [...before].every((key) => after.has(key));
}

function reachedFrom(usage: Usage, key: string, name: string, owner: string): {
  readonly usedBy: readonly string[];
  readonly uses: number;
  readonly sites: readonly Use[];
} {
  const sites = usage.names.get(key)?.get(name) ?? [];
  const usedBy: string[] = [];
  for (const use of sites) {
    if (use.by !== owner && !usedBy.includes(use.by)) usedBy.push(use.by);
  }
  return { usedBy, uses: sites.length, sites };
}

function joinUsage(documented: Help, offerings: readonly Offering[], usage: Usage): Help {
  const packages = documented.packages.map((published) => ({
    ...published,
    openings: published.openings.map((opening) => ({
      ...opening,
      entries: opening.entries
        .map((entry) => ({
          ...entry,
          ...reachedFrom(usage, `${published.name} ${opening.subpath}`, entry.name, published.name),
        }))
        .sort(
          (a, b) =>
            b.usedBy.length - a.usedBy.length ||
            b.uses - a.uses ||
            (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
        ),
    })),
  }));
  return {
    packages,
    deep: usage.deep,
    exported: usage.exported,
    unreadable: [...offerings.flatMap((offering) => offering.unreadable ?? []), ...usage.unreadable],
  };
}

function scanScope(root: string, offerings: readonly Offering[]): { readonly root: string; readonly dirs: readonly string[] } {
  const crossesRoot = offerings.some((offering) => relative(root, realpathSync(offering.dir)).startsWith('..'));
  if (!crossesRoot) return { root, dirs: ['.'] };
  let repository = root;
  try {
    repository = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' }).trim();
  } catch { /* A non-Git workspace is its own scan boundary. */ }
  if (repository === root) return { root, dirs: ['.'] };

  const dirs = new Set<string>();
  for (const path of [root, ...offerings.map((offering) => offering.dir)]) {
    const from = relative(repository, realpathSync(path));
    if (from === '' || from.startsWith('..')) continue;
    dirs.add(from.split('/')[0]!);
  }
  return { root: repository, dirs: [...dirs].sort() };
}
