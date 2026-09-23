/**
 * A repository, walked once, as file records the graph can be built from.
 *
 * This is the half that needs a disk. [`files.ts`](./files.ts) says which paths
 * exist and what their names mean, [`read.ts`](./read.ts) turns a file's text
 * into specifiers and [`resolve.ts`](./resolve.ts) turns a specifier into a file;
 * this follows what those find, and decides how little of that work a second run
 * has to repeat.
 *
 * ## What it follows, and what it stops at
 *
 * The configured directories are the seed, not the boundary. A component under
 * `src/` imports `../design/button.css`, and that stylesheet imports
 * `../design/tokens.css`: both are pulled in even though neither is under a
 * configured root, because a change-management scan that only knows the files it
 * was pointed at cannot answer the one question it exists for.
 *
 * It stops at the repository edge. A specifier that resolves into `node_modules`
 * — or anywhere outside the root — is dropped: nothing in a diff of this
 * repository can be that file, so an edge to it can never carry a change.
 *
 * ## The package boundary
 *
 * In a workspace, `@scope/other` resolves through a symlink into that package's
 * **built output** unless it publishes a `source` condition, and built output is
 * not what anybody edits — an edge into `dist/` could never be reached by a diff,
 * so it is dropped rather than drawn. That leaves a real gap at every package
 * boundary, and it is the gap `nx` and `turbo` already fill: both compute
 * project-level affectedness across exactly that edge. Their answer joins this
 * one as additional seeds rather than replacing it.
 *
 * ## What a second run costs
 *
 * Three things arrive already known, and each one removes a layer of work. Git
 * names every file's content without opening it ([`tree.ts`](./tree.ts)); the
 * digest names what parsing that content produced ([`cache.ts`](./cache.ts)); and
 * the digest together with the shape of the tree names the file's whole record,
 * edges included ([`reuse.ts`](./reuse.ts)). With all three, an unchanged file
 * costs two map lookups, and a scan costs the diff rather than the repository.
 */

import { access } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import type { FileRecord } from '@variance-authority/core/relate';
import type { Digest } from './digest.js';
import { memoryParseCache, type Parsed, type ParseCache } from './cache.js';
import { gitTreeOf, treeOf } from './tree.js';
import { shapeOf, type RecordCache } from './reuse.js';
import { native, nativeFrontier, nativeGraph, type NativeBuilt } from './native.js';
import { adoptNativeParses } from './source-index.js';
import type { IndexedRecord } from './source-index-format.js';
import {
  READABLE,
  keyFor,
  languageFor,
  parseWay,
  seedFiles,
  seedPaths,
  type ParseWay,
} from './files.js';
import { loadGrammars } from './grammar.js';
import { worldIn, worldOn } from './world.js';
import { recordFor } from './record.js';
import {
  realPath,
  resolversFor,
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
   * on ([`before`](../../core/src/relate/before.ts)). Seeded here, the file and
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
  readonly digests?: ReadonlyMap<string, Digest> | false;

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
  if (options.changed !== undefined && options.digests !== undefined) {
    throw new Error('`changed` supplies Git identity and cannot be combined with `digests`');
  }
  // The real path, because resolution returns one. On macOS a temporary
  // directory is reached through `/var` and lives at `/private/var`, and a root
  // on the wrong side of that link puts every resolved file *outside* the
  // repository — an empty graph, no error, and a selector that narrows to
  // nothing while reporting success.
  const root = realPath(resolve(options.root));
  const resolvers = resolversFor(options);
  const addon = native();

  const built = new Map<string, FileRecord>();
  const cache = options.cache ?? memoryParseCache();
  const tree =
    options.digests === false
      ? undefined
      : options.digests === undefined
        ? await gitTreeOf(root, options.dirs, options.changed)
        : treeOf(options.digests);

  // Once, before anything is opened. Every grammar initialises asynchronously
  // and parses synchronously, and a reader is called from behind a digest-keyed
  // cache that cannot await — so the awaiting happens here or nowhere.
  await loadGrammars();

  // Every language but JavaScript resolves by asking about the tree rather
  // than walking a `node_modules` chain ([`world.ts`](./world.ts)), and the
  // scan already holds the answer for every path it knows.
  resolvers.tree = tree === undefined ? worldOn(root) : worldIn(tree.paths(), root);

  // No digests, no reuse. Not a policy — a record that names no bytes cannot be
  // checked against the bytes on disk, so there is nothing to reuse it against.
  const reuse = tree === undefined ? undefined : options.reuse;
  const shape = tree === undefined ? undefined : await shapeOf({ root, tree, options });
  if (shape !== undefined) reuse?.under(shape.shape);

  // The queue is repository-relative throughout. An edge already carries the
  // path this scan uses as a key, and the absolute form is wanted only where a
  // file is opened — which on a run that reuses everything is nowhere.
  const queue = tree?.seeds !== undefined
    ? [...tree.seeds]
    : tree !== undefined
    ? [...seedPaths(root, options.dirs, tree.paths())]
    : addon === undefined
    ? [...seedFiles(root, options.dirs)]
    : addon.seedFiles(root, [...options.dirs]);

  // Appended rather than merged into the directory seeds: these are exact
  // paths, not places to walk, and the tree holds every tracked file whatever
  // directories it was asked to seed from — so a config above `src/` has a
  // digest here even though no walk would have found it.
  //
  // A path that is not there is dropped here rather than recorded as a file
  // whose edges could not be read. The second is what a *misspelled* entry
  // would become: one typo in the configuration would name a file nobody wrote
  // in every report on the scan, and read there as a scan that had failed.
  for (const entry of options.before ?? []) {
    if (!READABLE.has(extname(entry))) continue;
    if (await readable(join(root, entry))) queue.push(entry);
  }

  let nativeGraphUsed = false;

  const accept = (file: string, way: ParseWay, fresh: NativeBuilt): void => {
    built.set(file, fresh.record);
    reuse?.set(fresh.record, fresh.witnesses, fresh.targets);
    const heldDigest = fresh.record.digest;
    if (fresh.read !== undefined && heldDigest !== undefined) {
      cache.set(keyFor(heldDigest, way), fresh.read);
    }
    if (fresh.read !== undefined) options.parsed?.(file, fresh.read);
    if (fresh.read !== undefined && fresh.targets !== undefined) {
      options.indexed?.(file, fresh.read, fresh.targets);
    }
    for (const edge of fresh.record.edges ?? []) {
      if (!built.has(edge.to) && READABLE.has(extname(edge.to))) queue.push(edge.to);
    }
  };

  const acceptRemembered = (
    file: string,
    digest: Digest,
    way: ParseWay,
    held: IndexedRecord,
  ): void => {
    const record = held.record;
    built.set(file, record);
    cache.keep?.(keyFor(digest, way));
    if (options.parsed !== undefined) {
      const read = cache.get(keyFor(digest, way));
      if (read !== undefined) {
        options.parsed(file, read);
        if (held.targets !== undefined) options.indexed?.(file, read, held.targets);
      }
    } else if (options.indexed !== undefined) {
      const read = cache.get(keyFor(digest, way));
      if (read !== undefined && held.targets !== undefined) options.indexed(file, read, held.targets);
    }
    for (const edge of record.edges ?? []) {
      if (!built.has(edge.to) && READABLE.has(extname(edge.to))) queue.push(edge.to);
    }
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
      if (built.has(file) || pendingSet.has(file)) continue;
      const digest = frontierDigests?.[head - frontierStart];
      const way = parseWay(file);
      const remembered = digest === undefined ? undefined : reuse?.getIndexed(file, digest);
      if (remembered !== undefined && digest !== undefined) {
        acceptRemembered(file, digest, way, remembered);
        continue;
      }
      // The native side reads modules and nothing else, so what it is handed is
      // named positively rather than as everything that is not a stylesheet: a
      // language it has never heard of must go down the JavaScript path, not be
      // passed to it because it failed to be CSS.
      if (addon !== undefined && languageFor(way) === 'module') {
        pending.push(file);
        pendingDigests.push(digest);
        pendingSet.add(file);
        continue;
      }
      const fresh = await recordFor({
        absolute: join(root, file),
        file,
        root,
        resolvers,
        cache,
        aliases: shape?.aliases,
        directories: shape?.shape.directories ?? new Map(),
        largestFile: options.largestFile ?? LARGEST_FILE,
        remembering: reuse !== undefined,
        ...(digest === undefined ? {} : { digest }),
      });
      accept(file, way, fresh);
    }

    if (pending.length > 0 && addon !== undefined) {
      let answers: readonly NativeBuilt[] | undefined;
      let answeredFiles: readonly string[] = pending;
      try {
        const useGraph = !nativeGraphUsed && tree?.native !== undefined && pending.length >= 10_000;
        const nativeOptions = {
          addon,
          ...(tree?.native === undefined ? {} : { tree: tree.native }),
          root,
          files: pending,
          largestFile: options.largestFile ?? LARGEST_FILE,
          digests: pendingDigests,
          aliases: shape?.aliases,
          directories: shape?.shape.directories ?? new Map(),
          remembering: reuse !== undefined,
          ...(options.tsconfig === undefined ? {} : { tsconfig: options.tsconfig }),
          ...(options.conditionNames === undefined ? {} : { conditionNames: options.conditionNames }),
        };
        if (useGraph) {
          const graph = nativeGraph(nativeOptions, options.parsed !== undefined || options.indexed !== undefined);
          answers = graph.built;
          if (graph.parseLayer !== undefined) adoptNativeParses(cache, graph.parseLayer);
          nativeGraphUsed = true;
          answeredFiles = answers.map((answer) => answer.record.file);
        } else {
          answers = nativeFrontier(nativeOptions);
        }
      } catch {
        // An acceleration is allowed to disappear and never to change the graph.
        // The oracle remains the recovery path for an unavailable or mismatched addon.
      }
      if (answers !== undefined) {
        const accepting = performance.now();
        for (const [index, file] of answeredFiles.entries()) {
          accept(file, parseWay(file), answers[index]!);
        }
        if (process.env['VARIANCE_SENSE_TIMINGS'] === '1') {
          process.stderr.write(`sense accept native: ${(performance.now() - accepting).toFixed(1)} ms\n`);
        }
      } else {
        for (const [index, file] of pending.entries()) {
          const digest = pendingDigests[index];
          const way = parseWay(file);
          const fresh = await recordFor({
            absolute: join(root, file),
            file,
            root,
            resolvers,
            cache,
            aliases: shape?.aliases,
            directories: shape?.shape.directories ?? new Map(),
            largestFile: options.largestFile ?? LARGEST_FILE,
            remembering: reuse !== undefined,
            ...(digest === undefined ? {} : { digest }),
          });
          accept(file, way, fresh);
        }
      }
    }

    // The JavaScript resolvers are clones sharing one cache. Native batches own
    // their resolver cache and drop it at the call boundary.
    resolvers.modules.clearCache();
  }

  const records = [...built.values()].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));

  return records;
}

/** Whether a path is there to be opened, without opening it. */
async function readable(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false,
  );
}
