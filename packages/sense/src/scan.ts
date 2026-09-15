/**
 * A repository, walked once, as file records the graph can be built from.
 *
 * This is the half that needs a disk. [`read.ts`](./read.ts) turns a file's text
 * into specifiers and [`resolve.ts`](./resolve.ts) turns a specifier into a file;
 * this walks, follows what it finds, and decides how little of that work a second
 * run has to repeat.
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

import { readdirSync, type Dirent } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, resolve } from 'node:path';
import { indexSource } from '@variance-authority/core/attribute';
import { digestString, type Digest } from './digest.js';
import type { FileEdge, FileRecord } from '@variance-authority/core/relate';
import { MODULE_EXTENSIONS, STYLE_EXTENSIONS, readModule, readStyle } from './read.js';
import { memoryParseCache, type Parsed, type ParseCache, type ParseKey } from './cache.js';
import { gitDigests } from './tree.js';
import { treeShapeOf, type RecordCache } from './reuse.js';
import { witnessesOf, type Aliases } from './witness.js';
import {
  EXCLUDE_DIRS,
  isRelative,
  kindFor,
  realPath,
  requestOf,
  resolveTo,
  resolversFor,
  toRepoPath,
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

/** Files whose declarations are not components, matching the component index. */
const NOT_DECLARING = ['.test.', '.spec.', '.stories.', '.d.ts'];

/**
 * Everything about a path that changes what its bytes mean, and nothing else.
 *
 * There are two things. The name picks the dialect handed to the parser and
 * decides whether the file is read as a stylesheet at all, and it decides
 * separately whether the file is indexed for component declarations — a
 * `.test.ts` is not. Read once, here, and carried to both the cache key and the
 * parse: a key and a parse that each work the path out for themselves is the
 * shape that lets them disagree, and the disagreement is silent.
 */
interface ParseWay {
  /** Every extension the basename carries: `.ts`, `.test.ts`, `.d.mts`. */
  readonly suffix: string;
  readonly declaring: boolean;
}

function parseWay(file: string): ParseWay {
  const name = basename(file);
  // From the *first* dot, not the last. `.d.mts` and `.mts` are different
  // dialects and `extname` cannot tell them apart.
  const dot = name.indexOf('.', 1);

  return {
    suffix: dot === -1 ? '' : name.slice(dot),
    declaring: !NOT_DECLARING.some((skip) => file.includes(skip)),
  };
}

/**
 * Whether this is read as a stylesheet, which the suffix already decided.
 *
 * Derived rather than carried, because the answer is wanted only where a file is
 * actually opened and the way is built for every file in the repository.
 */
function isStyle(way: ParseWay): boolean {
  return STYLE_EXTENSIONS.includes(way.suffix.slice(way.suffix.lastIndexOf('.')));
}

/**
 * The parse cache's key: these bytes, read this way.
 *
 * Joined with a separator no path can hold rather than hashed, because this runs
 * once per file in the repository on every run — including the runs that open
 * nothing at all ([`cache.ts`](./cache.ts) carries the measurement).
 */
function keyFor(digest: Digest, way: ParseWay): ParseKey {
  return `${digest}\u0000${way.suffix}\u0000${way.declaring ? '+' : '-'}`;
}

const READABLE = new Set([...MODULE_EXTENSIONS, ...STYLE_EXTENSIONS]);

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

  /** This file's content digest, when it was known without opening the file. */
  readonly digest?: Digest;
}

async function recordFor(
  subject: Subject,
): Promise<{
  readonly record: FileRecord;
  readonly witnesses: readonly string[];
  /** What the bytes said, for a caller that asked to be handed it. Absent when the file could not be read. */
  readonly read?: Parsed;
}> {
  const { absolute, file, root, resolvers, cache } = subject;
  const way = parseWay(file);
  const style = isStyle(way);

  // The order is the saving. A digest that arrived from git names a cache entry
  // that can be answered before the file is opened, so an unchanged file costs a
  // map lookup; only a miss falls through to a read.
  let digest = subject.digest;
  let read = digest === undefined ? undefined : cache.get(keyFor(digest, way));

  if (read === undefined) {
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
    witnesses: witnessesOf({
      file,
      requests: read.requests.map((asked) => asked.value),
      edges: edges.map((edge) => edge.to),
      directories: subject.directories,
      aliases: subject.aliases,
    }),
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

/** Every readable file under the configured roots, named the way the scan keys them. */
function seedFiles(root: string, dirs: readonly string[]): readonly string[] {
  const found: string[] = [];
  for (const dir of dirs) {
    const absolute = isAbsolute(dir) ? dir : join(root, dir);
    // The walk descends into known directories, so it can spell the relative
    // path as it goes instead of deriving it again from every file it finds.
    const prefix = absolute === root ? '' : toRepoPath(root, absolute);
    if (prefix !== undefined) walk(absolute, prefix, found);
  }

  return found;
}

/**
 * Every readable file under one directory, unless it is a repository of its own.
 *
 * A checkout inside a checkout — a worktree cut this morning, a vendored clone —
 * is a different repository that happens to sit at this path. Git tracks not one
 * file of it, so every file misses the digest lookup and is opened and parsed on
 * every run; and its files are another repository's copies of these ones, which
 * doubles every count taken over the walk. Neither is a judgement call, and the
 * directory listing already in hand says which directories those are.
 *
 * A seed is never tested this way, only what is found beneath it: a caller that
 * points the scan at a checkout means that checkout.
 */
function walk(dir: string, prefix: string, into: string[], seeded = true): void {
  let entries: readonly Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    // A configured directory that is not there contributes nothing. The refusal
    // that matters is an empty result, and the caller is the one that can say
    // whether an empty result is wrong.
    return;
  }

  if (!seeded && entries.some((entry) => entry.name === '.git')) return;

  for (const entry of entries) {
    const at = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!EXCLUDE_DIRS.includes(entry.name)) walk(join(dir, entry.name), at, into, false);
    } else if (READABLE.has(extname(entry.name))) into.push(at);
  }
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
