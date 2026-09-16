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

import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { indexSource } from '@variance-authority/core/attribute';
import { digestString, type Digest } from './digest.js';
import type { FileEdge, FileRecord } from '@variance-authority/core/relate';
import { readModule, readStyle } from './read.js';
import { memoryParseCache, type Parsed, type ParseCache } from './cache.js';
import { gitDigests } from './tree.js';
import { treeShapeOf, type RecordCache } from './reuse.js';
import { witnessesOf, type Aliases } from './witness.js';
import { READABLE, isStyle, keyFor, parseWay, seedFiles, type ParseWay } from './files.js';
import {
  isRelative,
  kindFor,
  realPath,
  requestOf,
  resolveTo,
  resolversFor,
  type ResolveOptions,
  type Resolvers,
} from './resolve.js';

export interface ScanOptions extends ResolveOptions {
  /** Repository root. Every path in the result is relative to it. */
  readonly root: string;
  /** Where to start walking. Relative to `root`, or absolute. */
  readonly dirs: readonly string[];

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
   * it. Past the cap the file is recorded `unknown`, which widens selection for
   * whatever imports it rather than narrowing on a blank.
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
 * How many files a scan walks before it drops the resolver's filesystem cache.
 *
 * `oxc-resolver` remembers what it learned about the tree — which directories
 * exist, which `package.json` and `tsconfig` govern them, what each directory
 * holds. That cache is bounded by the tree rather than by the number of
 * resolutions (1.2 million requests from one file stay flat at 68 MB; the same
 * 1.2 million spread over 200,000 files plateau at ~318 MB and stop), so it does
 * not leak — it simply ends up holding the whole repository, natively, where no
 * heap limit can reach it. Measured on a 200,000-file tree under a 512 MB heap,
 * three runs each way: **732-738 MiB of peak resident memory with this, 796-816
 * MiB without**. It is the only lever left that reaches native memory, and it is
 * what puts the scan under 600 MiB rather than just over it.
 *
 * It is paid for in time, not saved: dropping the cache costs the `stat` calls
 * to learn the same directories again, and those runs take 41-51 seconds against
 * 31. Two thousand files is where that trade sits — five hundred costs another
 * hundred seconds and saves nothing further, five thousand is four seconds
 * quicker and gives back thirty-eight mebibytes.
 *
 * It cannot cost an answer. The loop below is strictly sequential and
 * `resolveFileSync` returns before the next file is read, so there is never a
 * resolution in flight when the cache goes — the case the library's own warning
 * is about. The scan draws the same 1,210,225 edges with the clearing on and
 * off.
 */
const FILES_BETWEEN_CLEARS = 2_000;

/**
 * Every file reachable from `dirs`, with its outgoing edges and declarations.
 *
 * Records come back sorted by path, compared by code unit, so two scans of the
 * same tree produce byte-identical input to the graph and every report built on
 * one is diffable.
 */
export async function scanRelations(options: ScanOptions): Promise<readonly FileRecord[]> {
  // The real path, because resolution returns one. On macOS a temporary
  // directory is reached through `/var` and lives at `/private/var`, and a root
  // on the wrong side of that link puts every resolved file *outside* the
  // repository — an empty graph, no error, and a selector that narrows to
  // nothing while reporting success.
  const root = realPath(resolve(options.root));
  const resolvers = resolversFor(options);

  const built = new Map<string, FileRecord>();
  const cache = options.cache ?? memoryParseCache();
  const digests =
    options.digests === false
      ? undefined
      : (options.digests ?? (await gitDigests(root))) ?? undefined;

  // No digests, no reuse. Not a policy — a record that names no bytes cannot be
  // checked against the bytes on disk, so there is nothing to reuse it against.
  const reuse = digests === undefined ? undefined : options.reuse;
  const tree = digests === undefined ? undefined : await treeShapeOf({ root, digests, options });
  if (tree !== undefined) reuse?.under(tree.shape);

  // The queue is repository-relative throughout. An edge already carries the
  // path this scan uses as a key, and the absolute form is wanted only where a
  // file is opened — which on a run that reuses everything is nowhere.
  const queue = [...seedFiles(root, options.dirs)];

  // A queue with a moving head rather than `shift()`: the frontier of a monorepo
  // scan is thousands of paths, and `shift()` is linear in that.
  for (let head = 0; head < queue.length; head += 1) {
    const file = queue[head]!;
    if (built.has(file)) continue;

    const digest = digests?.get(file);
    const remembered = digest === undefined ? undefined : reuse?.get(file, digest);

    const way = parseWay(file);

    const fresh =
      remembered === undefined
        ? await recordFor({
          absolute: join(root, file),
          file,
          root,
          resolvers,
          cache,
          aliases: tree?.aliases,
          directories: tree?.shape.directories ?? new Map(),
          largestFile: options.largestFile ?? LARGEST_FILE,
          remembering: reuse !== undefined,
          ...(digest === undefined ? {} : { digest }),
        })
        : undefined;
    const record = remembered ?? fresh!.record;

    built.set(file, record);
    // A reused record answered without opening the file, so the parse cache was
    // never asked and would prune the entry for every unchanged blob in the
    // repository — leaving the next run that has to rebuild records with nothing
    // to rebuild them from. The blob is live; say so.
    if (remembered === undefined) reuse?.set(record, fresh!.witnesses);
    else if (digest !== undefined) cache.keep?.(keyFor(digest, way));

    // A reused record never opened the file, so the parse it was built from is
    // not in hand — but it is in the cache under the same digest, which is the
    // whole reason the two are kept together. Missing is possible and not an
    // error: a record can outlive the parse behind it when a cache was pruned
    // more aggressively than the records were.
    if (options.parsed !== undefined) {
      const read =
        fresh?.read ?? (digest === undefined ? undefined : cache.get(keyFor(digest, way)));
      if (read !== undefined) options.parsed(file, read);
    }

    for (const edge of record.edges ?? []) {
      if (!built.has(edge.to) && READABLE.has(extname(edge.to))) queue.push(edge.to);
    }

    // The three resolvers are clones sharing one cache, so clearing the first
    // clears the set.
    if (head % FILES_BETWEEN_CLEARS === FILES_BETWEEN_CLEARS - 1) resolvers.modules.clearCache();
  }

  const records = [...built.values()].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));

  return records;
}

interface Subject {
  readonly absolute: string;
  readonly file: string;
  readonly root: string;
  readonly resolvers: Resolvers;
  readonly cache: ParseCache;

  /** Where a bare specifier could land, when the tree bounds it. */
  readonly aliases: Aliases | undefined;

  /** Every directory the tree holds, which bounds where a lookup can land. */
  readonly directories: ReadonlyMap<string, Digest>;

  /** The largest file to open, in bytes. */
  readonly largestFile: number;

  /**
   * Whether a record cache is going to remember these records.
   *
   * The only reader of a record's witnesses is `reuse.set`, and with nothing
   * reusing, computing them is a directory lookup and two arrays per file that
   * are allocated and dropped. Measured on a 200,000-file tree: **4.4 seconds of
   * a 36-second scan**, spent to build something nothing receives.
   */
  readonly remembering: boolean;

  /** This file's content digest, when it was known without opening the file. */
  readonly digest?: Digest;
}

/**
 * A file's size, or nothing when it cannot be asked for.
 *
 * Nothing rather than a throw: a file that is gone or unreadable is the read
 * path's own answer to give, one `catch` below, where it already says so with
 * the error it got. Failing here would replace that with a worse message for
 * the same file.
 */
async function sized(absolute: string): Promise<number | undefined> {
  try {
    return (await stat(absolute)).size;
  } catch {
    return undefined;
  }
}

async function recordFor(
  subject: Subject,
): Promise<{
  readonly record: FileRecord;
  readonly witnesses: readonly string[];
  /** What the bytes said, for a caller that asked to be handed it. Absent when the file could not be read. */
  readonly read?: Parsed;
}> {
  const { absolute, file, root, resolvers, cache, largestFile } = subject;
  const way = parseWay(file);
  const style = isStyle(way);

  // The order is the saving. A digest that arrived from git names a cache entry
  // that can be answered before the file is opened, so an unchanged file costs a
  // map lookup; only a miss falls through to a read.
  let digest = subject.digest;
  let read = digest === undefined ? undefined : cache.get(keyFor(digest, way));

  if (read === undefined) {
    // Asked before the file is opened, and only on a miss — a file the digest
    // already answered for was never a candidate to read. One `stat` against a
    // parse that cannot be given back: the arena `parseSync` allocates is native
    // and freed when it decides to free it, so a file read and then regretted
    // has already cost its fifty times.
    const size = await sized(absolute);
    if (size !== undefined && size > largestFile) {
      return {
        record: {
          file,
          unknown:
            `${file} is ${size} bytes, over the ${largestFile} this scan opens: ` +
            'parsing it costs about fifty times that in memory, and it is almost ' +
            'certainly built output. Raise `largestFile` to read it anyway.',
        },
        witnesses: [],
      };
    }

    let contents: string;
    try {
      contents = await readFile(absolute, 'utf8');
    } catch (error) {
      // Not an empty record. A file that is in the graph because something
      // imports it and that cannot be read is the exact shape `unknown` exists
      // for: its edges are not none, they are unavailable.
      return {
        record: { file, unknown: `${file} could not be read: ${messageOf(error)}` },
        witnesses: [],
      };
    }

    digest ??= digestString(contents);
    read = parsedFrom(file, contents, way, style);
    cache.set(keyFor(digest, way), read);
  }

  const edges: FileEdge[] = [];
  const unresolved: string[] = [];
  const holes: string[] = [];

  for (const asked of read.requests) {
    const request = requestOf(asked.value);
    if (request === undefined) continue;

    const target = resolveTo({ resolvers, root, from: absolute, request, style });
    if (target === undefined) {
      unresolved.push(asked.value);
      // A bare specifier that does not resolve is a package this scan has no
      // business finding. A *relative* one names a path inside this repository
      // and could not be identified, which is a hole in the edge list rather
      // than an absence of one — so the file widens instead of narrowing.
      if (isRelative(request)) holes.push(asked.value);
      continue;
    }

    edges.push({ to: target, kind: kindFor(asked.kind, target) });
  }

  // The file is named here and only here. What `read` came back with is cached
  // against bytes rather than a path, so it cannot name the file it was about
  // ([`read.ts`](./read.ts)); this is the caller that knows which file it asked.
  const reasons = [
    ...(read.unknown === undefined ? [] : [read.unknown]),
    ...(holes.length === 0
      ? []
      : [`${holes.length} relative specifier(s) that resolve to nothing: ${holes.join(', ')}`]),
  ];

  return {
    record: {
      file,
      ...(digest === undefined ? {} : { digest }),
      ...(edges.length > 0 ? { edges: dedupe(edges) } : {}),
      ...(read.declares === undefined ? {} : { declares: read.declares }),
      ...(unresolved.length > 0 ? { unresolved: [...new Set(unresolved)].sort(byCodeUnit) } : {}),
      ...(reasons.length > 0 ? { unknown: `${file} — ${reasons.join('; ')}` } : {}),
    },
    read,
    witnesses: subject.remembering
      ? witnessesOf({
        file,
        requests: read.requests.map((asked) => asked.value),
        edges: edges.map((edge) => edge.to),
        directories: subject.directories,
        aliases: subject.aliases,
      })
      : [],
  };
}

/**
 * Everything one file's bytes say, before anything about where it sits.
 *
 * Split out because this — and only this — is what the parse cache holds. The
 * specifiers are strings the file wrote down; what they point at is a question
 * about the directory, the `tsconfig` and what is installed, and none of that is
 * in the bytes ([`cache.ts`](./cache.ts)).
 */
function parsedFrom(file: string, contents: string, way: ParseWay, style: boolean): Parsed {
  const read = style ? readStyle(file, contents) : readModule(file, contents);
  const declares = style || !way.declaring ? [] : Object.keys(indexSource(file, contents));

  return {
    requests: read.requests,
    ...(read.exports === undefined ? {} : { exports: read.exports }),
    ...(declares.length > 0 ? { declares: declares.sort(byCodeUnit) } : {}),
    ...(read.unknown === undefined ? {} : { unknown: read.unknown }),
  };
}

function dedupe(edges: readonly FileEdge[]): readonly FileEdge[] {
  const seen = new Set<string>();

  return edges
    .filter((edge) => {
      const key = `${edge.kind} ${edge.to}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => byCodeUnit(a.to, b.to) || byCodeUnit(a.kind, b.kind));
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
