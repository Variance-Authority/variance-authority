/**
 * What the repository imports and exports, read from the index the scan keeps.
 *
 * [`use.ts`](https://github.com/Variance-Authority/variance-authority/blob/main/packages/package/src/use.ts) can answer this by itself: walk every
 * directory, parse every module, collect every specifier. On this repository
 * that is 1336 files and about half a second, and the half second is paid again
 * on the next question about the same unchanged checkout. A repository ten times
 * the size — which is an ordinary repository — pays ten times that, every time,
 * to re-learn a tree where almost nothing moved.
 *
 * Nothing about the reading justifies the cost, because the reading is already
 * done. [`sense`](https://github.com/Variance-Authority/variance-authority/tree/main/packages/sense) keeps a durable, content-keyed index of exactly
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

import { relative, resolve } from 'node:path';
import { digestString } from '@variance-authority/core/format';
import { treeAtWorkspace, treeOf, type FileRecord, type Tree } from '@variance-authority/mcp/tools';
import {
  openSourceIndex,
  placesOf,
  forwardsDigest,
  scanRelations,
  sourceIndexPath,
  stepped,
  type ParseCache,
  type Progress,
} from '@variance-authority/sense';
import { taintRecords, type Taint } from '@variance-authority/sense/taint';
import {
  assembleHelp,
  everyEntry,
  ownership,
  passedOn,
  reachedFrom,
  readWorkspaceManifests,
  type Help,
  type HelpOptions,
  type ImportTargets,
  type Offering,
  type Usage,
  type WorkspaceManifests,
} from '@variance-authority/package/help';
import { collectingUsage } from './collect-usage.js';
import { indexedNames, type IndexedSource } from './indexed-surface.js';
import { operatorError } from './operator.js';
import { coversWhole, scanScope, scopeSourceIndexPath } from './scan-scope.js';
import {
  readWorkspaceSnapshot,
  republishWorkspaceSnapshot,
  tryPublishWorkspaceSnapshot,
  workspaceForwardsDigest,
  workspaceGeneration,
  workspacePackagesDigest,
  workspaceReadStarted,
} from './snapshot.js';

export interface ReadingOptions extends HelpOptions, IndexedUsageOptions {}

export interface AnsweringOptions extends ReadingOptions {
  /** Read the published generation regardless of age and perform no refresh. */
  readonly justAnswer?: boolean;
  /** Refresh a published generation older than this. Defaults to one hour. */
  readonly refreshAfterMs?: number;
}

/**
 * A read whose source index could not be saved. A tool reads lines out of the
 * index on disk and names out of the value it was given, so a value of this
 * read would answer with the last read's lines: it is thrown away, and the
 * generation before it stays whole, its value, index and times together.
 */
export class UnsavedRead extends Error {
  /** The reader's to fix, as {@link operatorError} says of any other refusal. */
  readonly varianceOperatorError = true;

  constructor(refused: string) {
    super(`the source index could not be saved: ${refused}`);
    this.name = 'UnsavedRead';
  }
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
    if (justAnswer) {
      throw operatorError(
        `${error instanceof Error ? error.message : String(error)}. ` +
          'Run `variance index`, or ask again without `--just-answer`, to read the checkout and publish one.',
        { cause: error },
      );
    }
    // With nothing to refresh a list is no read: the files it leaves out would come
    // from the index, under a time that says they were read now.
    const { changed: _, ...whole } = reading;
    return readWorkspace(root, whole);
  }

  const at = workspaceGeneration(recorded);
  const age = at === undefined ? Number.POSITIVE_INFINITY : Date.now() - Date.parse(at);
  if (justAnswer || (reading.changed === undefined && reading.taints === undefined && age <= refreshAfterMs)) {
    return recorded;
  }
  if (reading.changed?.length === 0 && reading.taints === undefined) {
    await republishWorkspaceSnapshot(recorded, reading.index ?? sourceIndexPath(resolve(root)));
    return recorded;
  }
  try {
    return await (reading.changed !== undefined || reading.taints !== undefined ? refreshWorkspace(root, recorded, reading) : readWorkspace(root, reading));
  } catch (error) {
    // The read is lost and the generation is whole: the look says what it did not compare. A read asked for now, or for edges only a taint adds, has no such answer.
    if (error instanceof UnsavedRead && refreshAfterMs !== 0 && reading.taints === undefined) return recorded;
    throw error;
  }
}

export interface IndexedUsageOptions {
  /** Where the index is kept. The checkout's own cache layer when absent. */
  readonly index?: string;
  /** Read each file's bytes from Git's object store, as `variance index --no-git` turns off. On when absent. */
  readonly packs?: boolean;
  /** Whether to publish what this scan learned. On, because the next question is the point. */
  readonly save?: boolean;
  /**
   * Whether that publication also saves this scan's records into the source
   * index. On. `variance index` turns it off: it published the index this scan
   * read a moment before, and it is the index's owner. A scan over part of the
   * checkout, a workspace's root and the members it lists outside it, keeps an
   * index of its own that nothing else saves, and saves it whatever this says.
   */
  readonly saveIndex?: boolean;
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
  /** Told each step as it starts and ends: the manifests, the source, the names, the publish. */
  readonly progress?: Progress;
}

async function scanIndexed(
  root: string,
  opened: ReadonlySet<string>,
  targets: ImportTargets,
  options: IndexedUsageOptions,
  dirs: readonly string[],
  at: string,
): Promise<{
  readonly usage: Usage;
  readonly sources: Map<string, IndexedSource>;
  readonly records: readonly FileRecord[];
  readonly cache: ParseCache;
  /** Whether the index is the one the reading keeps for itself, beside its root's, which nobody else saves. */
  readonly ownIndex: boolean;
  /** The digest of every `export … from` this scan read, as `forwardsDigest` states it. */
  readonly forwards: string;
  /** Save what this scan read, or throw {@link UnsavedRead}. */
  save(): Promise<void>;
}> {
  const where = resolve(root);
  const index = await openSourceIndex(at);
  const owner = ownership(where);
  const usage = collectingUsage(where, opened, targets);
  const sources = new Map<string, IndexedSource>();

  const records = await stepped(options.progress, `reading what each file imports and exports, under ${placesOf(where, dirs)}`, () => scanRelations({
    // What `scanScope` names: the workspace's own directory whole, not only its
    // members, since it holds source no `workspaces` entry claims — `tools/`, a
    // scripts directory, a config that imports from a package — and each member
    // it lists outside that directory. Nothing beside what it lists can import
    // from it. The scan declines to descend into a checkout that is not this
    // one, so the root means this repository.
    root: where,
    dirs,
    cache: index.cache,
    reuse: index.reuse,
    ...(options.changed === undefined ? {} : { changed: options.changed }),
    ...(options.packs === undefined ? {} : { packs: options.packs }),
    parsed: (file, parsed) => {
      usage.accept(file, owner(file), parsed);
    },
    indexed: (file, parsed, targets) => {
      sources.set(file, { parsed, targets });
      usage.targets(file, targets);
    },
  }));
  const tainted = await taintRecords(records, options.taints ?? [], { root: where, cache: index.cache });
  if (tainted.shadows.size > 0) {
    throw new Error(
      `Help source areas cannot apply subtractive taints: ${tainted.shadows.size} file(s) shadow a module. ` +
      'Pass addition-only taints for declarative module loads.',
    );
  }
  options.records?.(tainted.records, where);

  const joined = usage.read();
  const recordUnknown = records.flatMap((record) => record.unknown === undefined ? [] : [record.unknown]);
  return {
    usage: recordUnknown.length === 0
      ? joined
      : { ...joined, unreadable: [...joined.unreadable, ...recordUnknown] },
    sources,
    records: tainted.records,
    cache: index.cache,
    // A save keeps only the records this scan touched, and the index at `at`
    // covers exactly what this scan reads: the root's own, or the scope's.
    ownIndex: !coversWhole(dirs),
    forwards: forwardsDigest(usage.forwards()),
    save: async () => {
      const refused = await index.save();
      // An index that is not there, or does not open, holds no lines to pair with.
      if (refused !== undefined && index.state !== 'missing' && index.state !== 'damaged') throw new UnsavedRead(refused);
    },
  };
}

/**
 * A workspace, read with the index doing the expensive third of the work.
 *
 * The same value [`readHelp`](https://github.com/Variance-Authority/variance-authority/blob/main/packages/package/src/help.ts) returns and the same
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

/** `readWorkspace` over the manifests a caller read from `root` a moment before. */
export async function readWorkspaceOver(root: string, manifests: WorkspaceManifests, readStartedAt: string, options: ReadingOptions = {}): Promise<Help> {
  const read = await scanWorkspace(root, options, { manifests, readStartedAt });
  return documentWorkspace(read, options);
}

/**
 * Refresh volatile source facts while retaining a previously documented surface.
 *
 * Usage, exported names, unreadable files and the graph are always taken from
 * the new Sense scan. The entries — their lines, signatures, comments and README
 * mentions — stay on the supplied reading until what they were cut from changes:
 * the exported name set, an `export … from`, or the line or the text of a row an
 * entry prints. Any of those rebuilds documentation immediately rather than
 * waiting for the caller's slower documentation cadence. A refresh of `changed`
 * files keeps the time the supplied reading began, as `readStartedAt` says.
 */
export async function refreshWorkspace(
  root: string,
  documented: Help,
  options: ReadingOptions = {},
): Promise<Help> {
  // A listed refresh read those files and nothing else, so every other file is as old as `documented` read it.
  const kept = options.changed === undefined ? undefined : workspaceReadStarted(documented);
  const read = await scanWorkspace(root, options, kept === undefined ? undefined : { readStartedAt: new Date(kept).toISOString() });
  if (!sameSurface(read, documented)) return documentWorkspace(read, options);
  const help = joinUsage(documented, read.offerings, read.scanned.usage);
  if (options.save !== false) {
    if (options.saveIndex !== false || read.scanned.ownIndex) await read.scanned.save();
    await tryPublishWorkspaceSnapshot(read.workspace, read.root, help, read.scanned.records, read.readStartedAt, read.scanned.forwards, packagesDigest(read.root, read.offerings), options.index);
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
  /** When this read began, before it read anything: what a caller who read first says, or now. */
  readonly readStartedAt: string;
}

async function scanWorkspace(
  root: string,
  options: ReadingOptions,
  over?: { readonly manifests?: WorkspaceManifests; readonly readStartedAt: string },
): Promise<WorkspaceScan> {
  const readStartedAt = over?.readStartedAt ?? new Date().toISOString();
  const where = resolve(root);
  const { offerings, targets } = over?.manifests ?? await stepped(options.progress, `reading the package manifests of ${where}`, () =>
    readWorkspaceManifests(where, { ...options, tolerant: options.tolerant ?? true }));
  const scope = scanScope(where, offerings);
  const opened = new Set(
    offerings.flatMap((offering) =>
      offering.entrypoints.map((entry) => `${offering.name} ${entry.subpath}`),
    ),
  );

  const at = scopeSourceIndexPath(options.index ?? sourceIndexPath(where), scope.dirs);
  const scanned = await scanIndexed(scope.root, opened, targets, options, scope.dirs, at);
  options.tree?.(treeAtWorkspace(treeOf(scanned.records, scope.root), where));
  return {
    workspace: where,
    root: scope.root,
    offerings,
    scanned,
    ...(options.changed === undefined ? {} : { changed: options.changed }),
    readStartedAt,
  };
}

async function documentWorkspace(read: WorkspaceScan, options: ReadingOptions): Promise<Help> {
  const { root, offerings, scanned } = read;
  const help = await stepped(options.progress, 'reading the signatures and comments of the exported names', async () => {
    const names = await indexedNames(root, offerings, scanned.sources);
    return assembleHelp(root, offerings, scanned.usage, names);
  });
  // `assembleHelp` has consumed the lazy name reader. Keeping every transient
  // parse alive while two large artifacts are encoded turns a cold publication
  // into garbage-collection work proportional to the repository.
  scanned.sources.clear();
  if (options.save !== false) {
    await stepped(options.progress, 'publishing the questions', async () => {
      if (options.saveIndex !== false || scanned.ownIndex) await scanned.save();
      await tryPublishWorkspaceSnapshot(read.workspace, read.root, help, scanned.records, read.readStartedAt, scanned.forwards, packagesDigest(root, offerings), options.index);
    });
  }
  return help;
}

function sameSurface(read: WorkspaceScan, documented: Help): boolean {
  if (!samePackages(read, documented)) return false;
  if (read.changed?.length === 0) return true;
  return read.scanned.forwards === workspaceForwardsDigest(documented) && sameExportedSurface(read.changed, read.scanned.usage.exported, documented);
}

/**
 * The offerings a value is documented from, as a digest: names, declarations,
 * whether each declares an entry, and openings. The store keeps it in its head,
 * so a refresh compares manifests without keeping them.
 */
export function packagesDigest(root: string, offerings: readonly Offering[]): string {
  const shape = offerings.map((offering) => ({
    name: offering.name,
    declared: offering.declared,
    entry: offering.entry,
    openings: offering.entrypoints.map((entry) => ({
      subpath: entry.subpath,
      source: relative(root, entry.source),
    })),
  }));
  return digestString(JSON.stringify(shape));
}

/** Whether the offerings are the ones `documented` was published from; never for a value published without them. */
export function samePackages(read: Pick<WorkspaceScan, 'root' | 'offerings'>, documented: Help): boolean {
  const held = workspacePackagesDigest(documented);
  return held !== undefined && held === packagesDigest(read.root, read.offerings);
}

/**
 * Whether the rows of `files`, every file when absent, say what `documented`'s
 * do: which names they export, and for a name an entry prints, the lines and
 * the text the entry was cut from. A row nothing publishes moves freely.
 */
export function sameExportedSurface(files: readonly string[] | undefined, exported: Usage['exported'], documented: Help): boolean {
  const changed = files === undefined ? undefined : new Set(files);
  const shown = new Set([...everyEntry(documented)].map(([, , entry]) => `${entry.at}\0${entry.declared}`));
  const keys = (values: Help['exported']): Set<string> => new Set(
    values
      .filter((value) => changed === undefined || changed.has(value.at))
      .map((value) => {
        const key = `${value.at}\0${value.name}\0${value.kind}\0${Number(value.type)}`;
        return shown.has(`${value.at}\0${value.name}`) ? `${key}\0${value.line}\0${value.boundLine ?? ''}\0${value.doc ?? ''}\0${value.signature ?? ''}` : key;
      }),
  );
  const before = keys(documented.exported);
  const after = keys(exported);
  return before.size === after.size && [...before].every((key) => after.has(key));
}

export function joinUsage(documented: Help, offerings: readonly Offering[], usage: Usage): Help {
  const packages = documented.packages.map((published) => ({
    ...published,
    openings: published.openings.map((opening) => ({
      ...opening,
      whole: passedOn(usage, `${published.name} ${opening.subpath}`),
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
    byPath: usage.byPath,
    unfollowed: usage.unfollowed,
    exported: usage.exported,
    unreadable: [...offerings.flatMap((offering) => offering.unreadable ?? []), ...usage.unreadable],
  };
}
