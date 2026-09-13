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
import { extname, isAbsolute, join, resolve } from 'node:path';
import { indexSource } from '@variance-authority/core/attribute';
import { digestString, type Digest } from './digest.js';
import type { FileEdge, FileRecord } from '@variance-authority/core/relate';
import { MODULE_EXTENSIONS, STYLE_EXTENSIONS, readModule, readStyle } from './read.js';
import { memoryParseCache, type Parsed, type ParseCache } from './cache.js';
import { gitDigests } from './tree.js';
import { layoutOf, type RecordCache } from './reuse.js';
import { taintRecords, type Taint } from './taint/index.js';
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
   * Import diffs joined onto the records after the walk.
   *
   * What a file imports beyond, or short of, what its text says — a mocked
   * module, a framework's own import notation ([`taint`](./taint/index.ts)).
   * Applied after the records are built and never stored with them, so the
   * caches hold what was read and the taints hold what was meant.
   */
  readonly taints?: readonly Taint[];
}

/** Files whose declarations are not components, matching the component index. */
const NOT_DECLARING = ['.test.', '.spec.', '.stories.', '.d.ts'];

const READABLE = [...MODULE_EXTENSIONS, ...STYLE_EXTENSIONS];

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
  if (digests !== undefined) reuse?.under(layoutOf({ root, digests, options }));

  const queue = [...seedFiles(root, options.dirs)];

  // A queue with a moving head rather than `shift()`: the frontier of a monorepo
  // scan is thousands of paths, and `shift()` is linear in that.
  for (let head = 0; head < queue.length; head += 1) {
    const absolute = queue[head]!;
    const file = toRepoPath(root, absolute);
    if (file === undefined || built.has(file)) continue;

    const digest = digests?.get(file);
    const remembered = digest === undefined ? undefined : reuse?.get(file, digest);

    const record =
      remembered ??
      (await recordFor({
        absolute,
        file,
        root,
        resolvers,
        cache,
        ...(digest === undefined ? {} : { digest }),
      }));

    built.set(file, record);
    if (remembered === undefined) reuse?.set(record);

    for (const edge of record.edges ?? []) {
      const next = join(root, edge.to);
      if (!built.has(edge.to) && READABLE.includes(extname(edge.to))) queue.push(next);
    }
  }

  const records = [...built.values()].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));

  return options.taints === undefined ? records : taintRecords(records, options.taints, { ...options, root });
}

interface Subject {
  readonly absolute: string;
  readonly file: string;
  readonly root: string;
  readonly resolvers: Resolvers;
  readonly cache: ParseCache;

  /** This file's content digest, when it was known without opening the file. */
  readonly digest?: Digest;
}

async function recordFor(subject: Subject): Promise<FileRecord> {
  const { absolute, file, root, resolvers, cache } = subject;
  const style = STYLE_EXTENSIONS.includes(extname(file));

  // The order is the saving. A digest that arrived from git names a cache entry
  // that can be answered before the file is opened, so an unchanged file costs a
  // map lookup; only a miss falls through to a read.
  let digest = subject.digest;
  let read = digest === undefined ? undefined : cache.get(digest);

  if (read === undefined) {
    let contents: string;
    try {
      contents = await readFile(absolute, 'utf8');
    } catch (error) {
      // Not an empty record. A file that is in the graph because something
      // imports it and that cannot be read is the exact shape `unknown` exists
      // for: its edges are not none, they are unavailable.
      return { file, unknown: `${file} could not be read: ${messageOf(error)}` };
    }

    digest ??= digestString(contents);
    read = parsedFrom(file, contents, style);
    cache.set(digest, read);
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

  const reasons = [
    ...(read.unknown === undefined ? [] : [read.unknown]),
    ...(holes.length === 0
      ? []
      : [`${holes.length} relative specifier(s) that resolve to nothing: ${holes.join(', ')}`]),
  ];

  return {
    file,
    ...(digest === undefined ? {} : { digest }),
    ...(edges.length > 0 ? { edges: dedupe(edges) } : {}),
    ...(read.declares === undefined ? {} : { declares: read.declares }),
    ...(unresolved.length > 0 ? { unresolved: [...new Set(unresolved)].sort(byCodeUnit) } : {}),
    ...(reasons.length > 0 ? { unknown: reasons.join('; ') } : {}),
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
function parsedFrom(file: string, contents: string, style: boolean): Parsed {
  const read = style ? readStyle(file, contents) : readModule(file, contents);
  const declares =
    style || NOT_DECLARING.some((skip) => file.includes(skip))
      ? []
      : Object.keys(indexSource(file, contents));

  return {
    requests: read.requests,
    ...(read.exports === undefined ? {} : { exports: read.exports }),
    ...(declares.length > 0 ? { declares: declares.sort(byCodeUnit) } : {}),
    ...(read.unknown === undefined ? {} : { unknown: read.unknown }),
  };
}

/** Every readable file under the configured roots. */
function seedFiles(root: string, dirs: readonly string[]): readonly string[] {
  const found: string[] = [];
  for (const dir of dirs) walk(isAbsolute(dir) ? dir : join(root, dir), found);

  return found;
}

function walk(dir: string, into: string[]): void {
  let entries: readonly Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    // A configured directory that is not there contributes nothing. The refusal
    // that matters is an empty result, and the caller is the one that can say
    // whether an empty result is wrong.
    return;
  }

  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDE_DIRS.includes(entry.name)) walk(path, into);
    } else if (READABLE.includes(extname(entry.name))) into.push(path);
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
