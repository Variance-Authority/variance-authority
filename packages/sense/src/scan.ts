/**
 * Source closures built and settled by the native graph owner.
 *
 * Directories seed the walk; readable imports outside them join the closure.
 * Callers receive records in code-unit path order, and optional parse consumers
 * receive the same content-keyed values their cache keeps. Whole-record reuse
 * checks the file's identity and the resolution shape before the native work.
 */

import { access } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import type { FileRecord } from '@variance-authority/core/relate';
import { codeUnitOrder } from '@variance-authority/core/segment';
import type { Digest } from '@variance-authority/core/format';
import { memoryParseCache, type Parsed, type ParseCache } from './cache.js';
import { gitTreeOf, treeOf, type Tree } from './tree.js';
import { shapeOf, unlistedShapeOf, type RecordCache } from './reuse.js';
import type { NativeGitTree } from './native.js';
import { native, nativeRefusal } from './addon.js';
import { nativeIndexGraph, type NativeIndexGraph } from './native-index-graph.js';
import { decodeSourceIndex, encodeSourceIndex, type IndexedRecord } from './source-index-format.js';
import { keyFor, parseWay, seedPaths } from './files.js';
import { READABLE } from './language.js';
import { declinedForSize, stillTooLarge } from './record.js';
import { withDeclaredTsconfig } from './typescript.js';
import {
  realPath,
  type ResolveOptions,
} from './resolve.js';

export interface ScanOptions extends ResolveOptions {
  /** Repository root. Every path in the result is relative to it. */
  readonly root: string;
  /** Where to start walking. Relative to `root`, or absolute. */
  readonly dirs: readonly string[];

  /**
   * Individual files to start from as well, repository-relative.
   *
   * The harness. A `vitest.config.ts` lives outside every directory anybody
   * would point a component scan at, and what it loads — a setup module, an
   * environment — is the part of a run nothing imports and every test rests
   * on ([`before`](https://github.com/Variance-Authority/variance-authority/blob/main/packages/core/src/relate/before.ts)). Seeded here, the file and
   * everything it reaches become ordinary nodes, and the question *what does
   * the run rest on* becomes an ordinary walk.
   *
   * A path that does not exist, or that this cannot parse, is skipped rather
   * than thrown on: a repository names its harness once and edits it for years,
   * and an unreadable one is answered by the graph not holding it rather than
   * by a scan that refuses to produce a graph at all.
   */
  readonly before?: readonly string[];

  /**
   * Content digests for the tree, when something already knows them.
   *
   * Supplied by [`gitDigests`](./tree.ts) unless a caller passes its own, and
   * `false` to hash by reading instead. This is what turns the scan from a walk
   * over the repository into a walk over the diff: a digest that is already known
   * can be looked up before the file is opened, so an unchanged file costs a map
   * lookup rather than a read and a parse.
   */
  readonly digests?: ReadonlyMap<string, Digest> | Tree | false;

  /**
   * Whether a file's bytes are read out of Git's object store. On when absent.
   *
   * `false` opens every file the scan reads from the working tree instead, and
   * changes nothing else: the files are still listed from HEAD's trees, each
   * with its blob, so reuse is keyed exactly as it is with packs. It is for a checkout whose
   * object store is expensive or unsafe to open — a partial clone, a store on a
   * network filesystem — where the working tree is already on the disk.
   */
  readonly packs?: boolean;

  /**
   * Every added, edited, deleted or renamed file since the last reading,
   * relative to `root`.
   *
   * Present means authoritative, including an empty list. Git still supplies
   * the committed path set, but `status` is skipped and only these paths are
   * hashed from disk. A rename therefore names both its old and new path.
   */
  readonly changed?: readonly string[];

  /**
   * Content-keyed parses, in memory when absent. A known file digest lets the
   * native graph reuse a held parse. Without one it parses the acquired bytes;
   * callbacks still receive an existing cached value for their content key.
   */
  readonly cache?: ParseCache;

  /**
   * The cache's parse stores, read for a tracked module before it is opened
   * ([`parse-store.ts`](./parse-store.ts)). A module one answers is resolved
   * here as if it were read, and its parse is `cache`'s to keep from the store:
   * `cache` has to read the same stores.
   */
  readonly stores?: readonly string[];

  /**
   * The largest file this scan will open, in bytes. `LARGEST_FILE` when absent.
   *
   * A parse costs about fifty times the file's bytes in a native arena, and a
   * file with many export bindings costs another twenty-five to forty on top of
   * that for the module record. Measured: a 40 MB barrel peaks at 2.9 GB, a
   * 40 MB minified bundle at 2.6 GB — and the second one does it with a JS heap
   * of 127 MB, because the arena is native. `--max-old-space-size` cannot bound
   * it and `process.memoryUsage()` cannot see it, so in a container it is an
   * OOM kill with no error and no stack.
   *
   * The files that reach that size are built output — a bundle, a generated
   * client, a vendored dist — and a repository large enough to matter has some.
   * One of them is the whole memory budget, and nothing in its edges was worth
   * it. Past the cap the file is recorded `unknown` with its size, rather than
   * as a file that imports nothing, and its edges are left to the recorded run.
   */
  readonly largestFile?: number;

  /**
   * Where whole records are remembered between runs. Nothing when absent.
   *
   * Unlike the parse cache this one is off by default, because it is only sound
   * with digests: a record with no digest names no bytes, and reusing it would be
   * reusing edges nothing checked ([`reuse.ts`](./reuse.ts)).
   */
  readonly reuse?: RecordCache;

  /**
   * Every file's parse, handed out as the scan settles it.
   *
   * The scan already holds, for each file, the repository-relative path and what
   * its bytes said — cached against the digest, so an unchanged file was never
   * opened. A caller that wants a *different* reading of the same bytes (which
   * names one file imports, where a specifier is written) has two choices: walk
   * and parse the repository again for itself, or be handed this. Handed this,
   * a second reading of a tree that did not change costs a map lookup per file.
   *
   * Called once per file, reused records included. It is not called for a file
   * that could not be read, because there is nothing to hand over.
   *
   * The `Parsed` is the cached value itself, not a copy: treat it as read-only,
   * because every other caller of the scan holds the same object.
   */
  readonly parsed?: (file: string, parsed: Parsed) => void;

  /** A parse together with the path-dependent target of each request. */
  readonly indexed?: (
    file: string,
    parsed: Parsed,
    targets: readonly (string | undefined)[],
  ) => void;
}

/**
 * One megabyte, which is larger than source people write and smaller than
 * output machines generate.
 *
 * The largest hand-written file in this repository is under a hundred kilobytes
 * and Material UI's is under two hundred; the files that pass a megabyte are
 * bundles, and three copies of one built runtime were the whole of a 548 MB
 * scan that looked like a scale problem. At the cap a single file costs about a
 * hundred megabytes of arena, which is a budget a scan can hold; at ten times it
 * the same file costs eight hundred.
 *
 * A record declined at this limit names the bytes it declined and is kept, and
 * a run at the default names no limit in its configuration digest (`configOf`
 * in [`reuse.ts`](./reuse.ts)). So a change to this value bumps `VERSION`
 * there, or every index keeps the records the old limit declined.
 */
export const LARGEST_FILE = 1024 * 1024;

/**
 * Every file reachable from `dirs`, with its outgoing edges and declarations.
 *
 * Records come back sorted by path, compared by code unit, so two scans of the
 * same tree produce byte-identical input to the graph and every report built on
 * one is diffable.
 */
export async function scanRelations(options: ScanOptions): Promise<readonly FileRecord[]> {
  const { built, graph } = await scanning(options);
  if (graph !== undefined) {
    for (const { record } of decodeSourceIndex(graph.encode([])).records.values()) built.set(record.file, record);
  }
  return [...built.values()].sort((a, b) => codeUnitOrder(a.file, b.file));
}

/** What {@link scanCount} counted, and the listing it took of the checkout. */
export interface ScanCounted {
  readonly files: number;
  /** The modules whose bytes the scan parsed: neither a record nor a parse store answered them. */
  readonly parsed: number;
  /** The listing git gave the scan; absent when git could not list the checkout, or the addon did not hold it. */
  readonly listing?: NativeGitTree;
}

/**
 * How many files {@link scanRelations} would return, for a caller that hands
 * `cache` and `reuse` their records and needs only the count back, with the
 * listing the scan took, for a step after it to carry.
 *
 * A cold closure the addon holds is counted where it is, so a build that
 * publishes the index never turns the closure into objects just to count them.
 */
export async function scanCount(options: ScanOptions): Promise<ScanCounted> {
  const { built, graph, listing, parsed } = await scanning(options);
  const counted = (files: number, read: number): ScanCounted =>
    (listing === undefined ? { files, parsed: read } : { files, parsed: read, listing });
  if (graph === undefined) return counted(built.size, parsed);
  let both = 0;
  for (const file of built.keys()) if (graph.has(file)) both += 1;
  // A closure the addon holds read every module it names.
  return counted(built.size + graph.size - both, parsed + graph.parsed);
}

interface Scanned {
  /** Records decoded for public consumers or supplied by the record cache. */
  readonly built: Map<string, FileRecord>;
  /** The cold closure the addon holds, whose records win where both name a file. */
  readonly graph?: NativeIndexGraph;
  /** The listing of the checkout the scan took, when the addon holds it. */
  readonly listing?: NativeGitTree;
  /** The modules whose bytes the scan had parsed, but for a closure the addon holds. */
  readonly parsed: number;
}

async function scanning(asked: ScanOptions): Promise<Scanned> {
  if (asked.changed !== undefined && asked.digests !== undefined) {
    throw new Error('`changed` supplies Git identity and cannot be combined with `digests`');
  }
  const root = realPath(resolve(asked.root));
  const options = withDeclaredTsconfig(root, asked);
  const addon = native();
  if (addon === undefined) {
    throw new Error(`sense: scanning ${root} needs the native addon, which did not load: ${nativeRefusal()}`);
  }
  const tree = options.digests === false ? undefined
    : options.digests === undefined ? await gitTreeOf(root, options.dirs, options.changed)
    : treeOf(options.digests);
  const shape = tree === undefined ? undefined : await shapeOf({ root, tree, options });
  const reuse = tree === undefined && options.digests === false ? undefined : options.reuse;
  if (shape !== undefined) reuse?.under(shape.shape);
  else if (reuse !== undefined) reuse.under(await unlistedShapeOf({ root, options }));

  const paths = tree?.native === undefined ? tree?.paths() : undefined;
  const seeds = tree?.seeds ?? (paths === undefined ? undefined : seedPaths(root, options.dirs, paths));
  const holder = tree?.native ?? (paths === undefined
    ? addon.filesystemTree(root, [...options.dirs])
    : addon.sourceTree(root, [...paths], [...seeds!]));
  const queue = [...seeds ?? holder.seeds()];
  for (const entry of options.before ?? []) {
    if (READABLE.has(extname(entry)) && await readable(join(root, entry))) queue.push(entry);
  }
  const identities = paths === undefined ? undefined : Object.fromEntries(
    paths.flatMap((file) => {
      const digest = tree!.get(file);
      return digest === undefined ? [] : [[file, digest]];
    }),
  );
  const listing = tree?.native !== undefined && !tree.native.filesystem ? tree.native : undefined;
  const cache = options.cache ?? memoryParseCache();
  const rustPrior = new Map<string, Parsed>();
  if (options.cache !== undefined && tree !== undefined) {
    const rust = (paths ?? tree.paths()).filter((file) => extname(file) === '.rs');
    const named = tree.getAll(rust);
    for (const [at, file] of rust.entries()) {
      const digest = named[at];
      if (digest === undefined) continue;
      const key = keyFor(digest, parseWay(file));
      const read = cache.get(key);
      if (read !== undefined) rustPrior.set(key, read);
    }
  }
  const session = addon.newScanSession(rustPrior.size === 0 ? undefined
    : encodeSourceIndex({ parses: rustPrior, directories: new Map(), records: new Map() }));
  const built = new Map<string, FileRecord>();
  const largestFile = options.largestFile ?? LARGEST_FILE;
  let parsed = 0;

  const follow = (record: FileRecord): void => {
    for (const edge of record.edges ?? []) {
      if (!built.has(edge.to) && READABLE.has(extname(edge.to))) queue.push(edge.to);
    }
  };
  const handOver = (file: string, read: Parsed | undefined, targets?: readonly (string | undefined)[]): void => {
    if (read === undefined) return;
    options.parsed?.(file, read);
    if (targets !== undefined) options.indexed?.(file, read, targets);
  };
  const acceptRemembered = (file: string, digest: Digest, held: IndexedRecord): void => {
    built.set(file, held.record);
    const key = keyFor(digest, parseWay(file));
    cache.keep?.(key);
    if (options.parsed !== undefined || options.indexed !== undefined) handOver(file, cache.get(key), held.targets);
    follow(held.record);
  };

  for (let head = 0; head < queue.length;) {
    const end = queue.length;
    const files: string[] = [];
    const pending = new Set<string>();
    const prior = new Map<string, Parsed>();
    const digests = tree?.getAll(queue.slice(head, end));
    const start = head;
    for (; head < end; head += 1) {
      const file = queue[head]!;
      if (built.has(file) || pending.has(file)) continue;
      const digest = digests?.[head - start];
      let held = digest === undefined ? undefined : reuse?.getIndexed(file, digest);
      if (held !== undefined && declinedForSize(held.record) && !(await stillTooLarge(join(root, file), largestFile))) held = undefined;
      if (held !== undefined && digest !== undefined) {
        acceptRemembered(file, digest, held);
        continue;
      }
      files.push(file);
      pending.add(file);
      if (digest !== undefined && options.cache !== undefined) {
        const key = keyFor(digest, parseWay(file));
        const read = cache.get(key);
        if (read !== undefined) prior.set(key, read);
      }
    }
    if (files.length === 0) continue;
    const graph = nativeIndexGraph(holder, {
      session,
      root, seeds: files, largestFile, remembering: reuse !== undefined,
      aliases: shape?.aliases, directories: shape?.shape.directories ?? new Map(),
      follow: reuse === undefined && options.cache === undefined,
      ...(identities === undefined ? {} : { identities }),
      ...(prior.size === 0 ? {} : { priorParses: encodeSourceIndex({ parses: prior, directories: new Map(), records: new Map() }) }),
      ...(options.packs === undefined ? {} : { packs: options.packs }),
      ...(options.stores === undefined ? {} : { stores: options.stores }),
      ...(options.tsconfig === undefined ? {} : { tsconfig: options.tsconfig }),
      ...(options.conditionNames === undefined ? {} : { conditionNames: options.conditionNames }),
    });
    if (reuse === undefined && options.cache === undefined && options.parsed === undefined && options.indexed === undefined) {
      return { built, graph, parsed, ...(listing === undefined ? {} : { listing }) };
    }
    parsed += graph.parsed;
    const rows = decodeSourceIndex(graph.encode([])).records;
    const reads = decodeSourceIndex(graph.parseSegment()).parses;
    const handed = new Set<string>();
    for (const [file, held] of rows) {
      built.set(file, held.record);
      reuse?.set(held.record, held.witnesses, held.targets);
      const key = held.record.digest === undefined ? undefined : keyFor(held.record.digest, parseWay(file));
      const read = key === undefined || !reads.has(key) ? undefined : cache.get(key) ?? reads.get(key);
      if (key !== undefined && read !== undefined) {
        cache.set(key, read);
        handed.add(key);
      }
      handOver(file, read, held.targets);
      follow(held.record);
    }
    for (const [key, read] of reads) {
      if (!handed.has(key)) cache.set(key, cache.get(key) ?? read);
    }
  }
  return { built, parsed, ...(listing === undefined ? {} : { listing }) };
}

/** Whether a path is there to be opened, without opening it. */
async function readable(file: string): Promise<boolean> {
  return access(file).then(() => true, () => false);
}
