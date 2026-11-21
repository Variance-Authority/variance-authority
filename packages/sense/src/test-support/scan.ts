/**
 * The JavaScript scanner the native source index replaced, kept as a test
 * oracle: sense's tests compare what the index records against what this walk
 * finds. Nothing outside tests imports it, and the package does not ship it.
 */

import { access } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import type { FileRecord } from '@variance-authority/core/relate';
import { codeUnitOrder } from '@variance-authority/core/segment';
import type { Digest } from '@variance-authority/core/format';
import { memoryParseCache, type Parsed, type ParseCache, type ParseKey } from '../cache.js';
import { gitTreeOf, treeOf } from '../tree.js';
import { shapeOf, unlistedShapeOf, type RecordCache } from '../reuse.js';
import { nativeFrontier, nativeGraph, type NativeBuilt } from '../native.js';
import { native, nativeRefusal } from '../addon.js';
import { adoptNativeParses } from '../source-index.js';
import { graphRecords, nativeIndexGraph, type NativeIndexGraph } from '../native-index-graph.js';
import { encodeSourceIndex, type IndexedRecord } from '../source-index-format.js';
import { handOverKept, type Unheld } from '../parse-store.js';
import { keyFor, parseWay, seedPaths, type ParseWay } from '../files.js';
import { READABLE } from '../language.js';
import { declinedForSize, LARGEST_FILE, stillTooLarge } from '../record.js';
import { withDeclaredTsconfig } from '../typescript.js';
import { realPath, type ResolveOptions } from '../resolve.js';

export interface ScanOptions extends ResolveOptions {
  /** Repository root. Every path in the result is relative to it. */
  readonly root: string;
  /** Where to start walking. Relative to `root`, or absolute. */
  readonly dirs: readonly string[];

  /** Individual repository-relative files to start from as well; one that is not there is skipped. */
  readonly before?: readonly string[];

  /**
   * Content digests for the tree: `gitDigests` unless a caller passes its own,
   * `false` to hash by reading. A caller's map must cover the checkout.
   */
  readonly digests?: ReadonlyMap<string, Digest> | false;

  /**
   * Whether a file's bytes are read out of Git's object store. On when absent.
   *
   * `false` reads files from the working tree when the object store is expensive
   * or unsafe to open, such as a partial clone or network filesystem.
   * Without `changed`, Git's index supplies inventory and local changes are
   * overlaid. With `changed`, inventory comes from HEAD, only the named paths
   * are rehashed, and files are read from the working tree regardless of `packs`.
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

  /** Where parses are remembered between runs. In memory when absent. */
  readonly cache?: ParseCache;

  /**
   * The cache's parse stores, read for a tracked module before it is opened
   * ([`parse-store.ts`](../parse-store.ts)). A module one answers is resolved
   * here as if it were read, and its parse is `cache`'s to keep from the store:
   * `cache` has to read the same stores.
   */
  readonly stores?: readonly string[];

  /** The largest file this scan will open, in bytes; `LARGEST_FILE` when absent. */
  readonly largestFile?: number;

  /**
   * Where whole records are remembered between runs. Nothing when absent.
   *
   * Unlike the parse cache this one is off by default, because it is only sound
   * with digests: a record with no digest names no bytes, and reusing it would be
   * reusing edges nothing checked ([`reuse.ts`](../reuse.ts)).
   */
  readonly reuse?: RecordCache;

  /** Every file's parse as the scan settles it, reused records included; read-only. */
  readonly parsed?: (file: string, parsed: Parsed) => void;

  /** A parse together with the path-dependent target of each request. */
  readonly indexed?: (
    file: string,
    parsed: Parsed,
    targets: readonly (string | undefined)[],
  ) => void;
}


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
    for (const record of graphRecords(graph)) built.set(record.file, record);
  }
  return [...built.values()].sort((a, b) => codeUnitOrder(a.file, b.file));
}

interface Scanned {
  /** Every record the scan built or reused in JavaScript. */
  readonly built: Map<string, FileRecord>;
  /** The cold closure the addon holds, whose records win where both name a file. */
  readonly graph?: NativeIndexGraph;
}

async function scanning(asked: ScanOptions): Promise<Scanned> {
  if (asked.changed !== undefined && asked.digests !== undefined) {
    throw new Error('`changed` supplies Git identity and cannot be combined with `digests`');
  }
  // The real path, because resolution returns one. On macOS a temporary
  // directory is reached through `/var` and lives at `/private/var`, and a root
  // on the wrong side of that link puts every resolved file *outside* the
  // repository — an empty graph, no error, and a selector that narrows to
  // nothing while reporting success.
  const root = realPath(resolve(asked.root));
  const options = withDeclaredTsconfig(root, asked);
  const addon = native();
  if (addon === undefined) {
    throw new Error(`sense: scanning ${root} needs the native addon, which did not load: ${nativeRefusal()}`);
  }

  const built = new Map<string, FileRecord>();
  const cache = options.cache ?? memoryParseCache();
  const tree =
    options.digests === false
      ? undefined
      : options.digests === undefined
        ? await gitTreeOf(root, options.dirs, options.changed)
        : treeOf(options.digests);

  const largestFile = options.largestFile ?? LARGEST_FILE;

  // No digests, no reuse: a record that names no bytes cannot be checked against the
  // bytes on disk. A directory git cannot list still keeps what it read, under a shape
  // no listed scan reuses, since the index is read for it; `digests: false` keeps none.
  const reuse = tree === undefined && options.digests === false ? undefined : options.reuse;
  const shape = tree === undefined ? undefined : await shapeOf({ root, tree, options });
  if (tree === undefined) reuse?.under(await unlistedShapeOf({ root, options }));
  // FIXME: under a clean or smudge filter — LFS, `core.autocrlf`, `working-tree-encoding` —
  // a blob and its checked-out file differ, both parse under the blob's digest, and an
  // index keeps whichever it read first until the blob changes. A decline for size is
  // checked against the file; one for bytes that are not UTF-8 is not.
  const packed = options.packs === false ? undefined : tree?.native;
  // A native batch over a tree the addon does not hold is handed the tree's
  // listing: a module under a tracked `build/` lands only when it is listed,
  // and every other language resolves by asking the listing what is there.
  // Without a tree the batch walks the disk for the same answer.
  if (shape !== undefined) reuse?.under(shape.shape);

  // The queue is repository-relative throughout. An edge already carries the
  // path this scan uses as a key, and the absolute form is wanted only where a
  // file is opened — which on a run that reuses everything is nowhere.
  const queue = tree?.seeds !== undefined
    ? [...tree.seeds]
    : tree !== undefined
    ? [...seedPaths(root, options.dirs, tree.paths())]
    : addon.seedFiles(root, [...options.dirs]);

  // Exact paths, appended after the directory seeds; one that is not there is
  // dropped, so a misspelled entry names no file nobody wrote.
  for (const entry of options.before ?? []) {
    if (!READABLE.has(extname(entry))) continue;
    if (await readable(join(root, entry))) queue.push(entry);
  }

  let nativeGraphUsed = false;
  let graph: NativeIndexGraph | undefined;
  const unheld: Unheld[] = []; // kept by the scan, after the cache read the stores without it

  const follow = (record: FileRecord): void => {
    for (const edge of record.edges ?? []) {
      if (!built.has(edge.to) && READABLE.has(extname(edge.to))) queue.push(edge.to);
    }
  };
  // A parse the cache holds and the answer does not — a reused record's, or one
  // a store kept — is read back only for a caller that asked to be handed it.
  const handOver = (file: string, read: Parsed | undefined, key: string | undefined, targets?: readonly (string | undefined)[]): void => {
    const asked = options.parsed !== undefined || options.indexed !== undefined;
    const parse = read ?? (key !== undefined && asked ? cache.get(key) : undefined);
    if (parse === undefined) return;
    options.parsed?.(file, parse);
    if (targets !== undefined) options.indexed?.(file, parse, targets);
  };

  const accept = (file: string, way: ParseWay, fresh: NativeBuilt): void => {
    built.set(file, fresh.record);
    reuse?.set(fresh.record, fresh.witnesses, fresh.targets);
    const key = fresh.record.digest === undefined ? undefined : keyFor(fresh.record.digest, way);
    if (fresh.read !== undefined && key !== undefined) cache.set(key, fresh.read);
    // A kept parse crossed as what its record needs; the whole one is the store's.
    if (fresh.kept === true && key !== undefined) cache.keep?.(key);
    if (fresh.kept === true && key !== undefined && cache.keep !== undefined && cache.get(key) === undefined) unheld.push({ file, key, fresh });
    else handOver(file, fresh.read, fresh.kept === true ? key : undefined, fresh.targets);
    follow(fresh.record);
  };

  const acceptRemembered = (file: string, digest: Digest, way: ParseWay, held: IndexedRecord): void => {
    built.set(file, held.record);
    cache.keep?.(keyFor(digest, way));
    handOver(file, undefined, keyFor(digest, way), held.targets);
    follow(held.record);
  };

  // One frontier per call: every file currently known is parsed and resolved on
  // the native side, then newly reached files form the next frontier. A hot
  // record still costs only its two lookups and never enters the batch.
  for (let head = 0; head < queue.length;) {
    const frontierStart = head;
    const end = queue.length;
    const frontierDigests = tree?.getAll(queue.slice(head, end));
    const pending: string[] = [];
    const pendingDigests: (Digest | undefined)[] = [];
    const pendingSet = new Set<string>();
    for (; head < end; head += 1) {
      const file = queue[head]!;
      if (built.has(file) || graph?.has(file) || pendingSet.has(file)) continue;
      const digest = frontierDigests?.[head - frontierStart];
      const way = parseWay(file);
      let remembered = digest === undefined ? undefined : reuse?.getIndexed(file, digest);
      // A decline for size is decided on the checked-out bytes: `stillTooLarge`.
      const fits = remembered && declinedForSize(remembered.record) && !(await stillTooLarge(join(root, file), largestFile));
      if (fits) remembered = undefined;
      if (remembered !== undefined && digest !== undefined) {
        acceptRemembered(file, digest, way, remembered);
        continue;
      }
      pending.push(file);
      pendingDigests.push(digest);
      pendingSet.add(file);
    }

    if (pending.length > 0) {
      const useGraph = !nativeGraphUsed && packed !== undefined && pending.length >= 10_000;
      // A caller's cache answers its parses ahead of any stores, in the batch
      // and the closure graph alike. The graph is handed its seeds' alone: a
      // file it reaches beyond them has no digest here until the walk reads it.
      const cached = options.cache === undefined ? undefined : heldOf(options.cache, pending, pendingDigests);
      const nativeOptions = {
        addon,
        ...(packed === undefined ? {} : { tree: packed }),
        ...(packed === undefined && tree !== undefined ? { listed: tree.paths() } : {}),
        root,
        dirs: options.dirs,
        files: pending,
        largestFile,
        digests: pendingDigests,
        directories: shape?.shape.directories ?? new Map(),
        remembering: reuse !== undefined,
        ...(options.stores === undefined ? {} : { stores: options.stores }),
        ...(cached === undefined ? {} : { held: cached }),
        ...(options.tsconfig === undefined ? {} : { tsconfig: options.tsconfig }),
        ...(options.conditionNames === undefined ? {} : { conditionNames: options.conditionNames }),
      };
      // A closure nobody asked to see file by file is held where it was built:
      // no callback wants its parses, and the record cache — when there is
      // one — publishes it without asking for the records back.
      const held = useGraph && packed !== undefined &&
          options.parsed === undefined && options.indexed === undefined &&
          (reuse === undefined || reuse.adopt !== undefined)
        ? nativeIndexGraph(packed, { ...nativeOptions, seeds: pending })
        : undefined;
      let answers: readonly NativeBuilt[] = [];
      let answeredFiles: readonly string[] = pending;
      if (held !== undefined) {
        graph = held;
        nativeGraphUsed = true;
        answeredFiles = [];
        adoptNativeParses(cache, { get bytes() { return held.parseSegment(); }, keys: { has: (key) => held.hasParse(key) } });
        reuse?.adopt?.(held);
        for (const file of held.following()) {
          if (!built.has(file) && READABLE.has(extname(file))) queue.push(file);
        }
      } else if (useGraph) {
        const graph = nativeGraph(nativeOptions, options.parsed !== undefined || options.indexed !== undefined);
        answers = graph.built;
        if (graph.parseLayer !== undefined) adoptNativeParses(cache, graph.parseLayer);
        nativeGraphUsed = true;
        answeredFiles = answers.map((answer) => answer.record.file);
      } else {
        answers = nativeFrontier(nativeOptions);
      }
      const accepting = performance.now();
      for (const [index, file] of answeredFiles.entries()) {
        accept(file, parseWay(file), answers[index]!);
      }
      if (packed !== undefined) handOverKept(packed, options.stores, cache, unheld.splice(0), handOver);
      if (process.env['VARIANCE_SENSE_TIMINGS'] === '1') {
        process.stderr.write(`sense accept native: ${(performance.now() - accepting).toFixed(1)} ms\n`);
      }
    }
  }

  return { built, ...(graph === undefined ? {} : { graph }) };
}

/** What `cache` holds for `files` at `digests`, as the parse-only segment a batch answers them from unopened. */
function heldOf(cache: ParseCache, files: readonly string[], digests: readonly (Digest | undefined)[]): Uint8Array | undefined {
  const parses = new Map<ParseKey, Parsed>();
  for (const [row, file] of files.entries()) {
    const key = digests[row] === undefined ? undefined : keyFor(digests[row], parseWay(file));
    const parse = key === undefined ? undefined : cache.get(key);
    if (key !== undefined && parse !== undefined) parses.set(key, parse);
  }
  return parses.size === 0 ? undefined : encodeSourceIndex({ parses, directories: new Map(), records: new Map() });
}

/** Whether a path is there to be opened, without opening it. */
async function readable(file: string): Promise<boolean> {
  return access(file).then(() => true, () => false);
}
