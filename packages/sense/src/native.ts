/**
 * The native scanner, when this checkout built one.
 *
 * It is an acceleration of the TypeScript scanner and never a replacement for
 * it: every answer it gives, the JavaScript path gives too, and the differential
 * tests are what say so. So a missing addon is not a degraded mode to warn
 * about — it is the implementation of record, running.
 *
 * Loaded through `createRequire` because a `.node` is a CommonJS object with no
 * ESM loader, and behind a single failed attempt because the failure is a
 * missing file rather than something a retry could change.
 */

import { createRequire } from 'node:module';
import type { EdgeKind, FileEdge, FileRecord } from '@variance-authority/core/relate';
import type { Parsed } from './cache.js';
import type { Digest } from './digest.js';
import { keyFor, parseWay } from './files.js';
import { isRelative, kindFor, requestOf, type ResolveOptions } from './resolve.js';
import type { Aliases } from './witness.js';
import { witnessesOf } from './witness.js';

/** Every tracked path under a root, with the digest of the bytes on disk. */
export interface NativeGitTree {
  readonly size: number;
  seeds(): string[];
  has(path: string): boolean;
  digest(path: string): string | null;
  digestsFor(paths: string[]): string[];
  scanBatch(
    root: string,
    files: string[],
    largestFile?: number,
    digests?: boolean,
    readers?: number,
    tsconfig?: string,
    conditionNames?: string[],
  ): NativeScanBatch;
  scanGraph(
    root: string,
    seeds: string[],
    largestFile?: number,
    readers?: number,
    tsconfig?: string,
    conditionNames?: string[],
    includeParses?: boolean,
  ): NativeScanBatch;
  paths(): string[];
  digests(): string[];
  named(names: string[]): string[];
  directories(): Record<string, string>;
  configDigest(header: string[], names: string[], aliasesUnknown: boolean): string;
}

/**
 * What a batch of files said, in columns rather than in objects.
 *
 * `counts[i]` is how many requests file `i` contributed; they follow the
 * previous file's in `values` and `kinds`. The whole point of the shape is that
 * a repository's worth of edges crosses as two arrays and a prefix sum, so a
 * reader walks it with a cursor and never allocates an object per edge unless it
 * wants one.
 */
export interface NativeReadBatch {
  readonly counts: Uint32Array;
  readonly digests: string[];
  readonly unknown: string[];
  readonly values: string[];
  /** Each request's kind, as an index into `kinds()`. */
  readonly kinds: Buffer;
  /** Complete `Parsed` JSON per file; empty when the file could not be read. */
  readonly parses: string[];
  /** One when bytes were parsed, even if parse JSON was not requested. */
  readonly parsed: Buffer;
  readonly declareCounts: Uint32Array;
  readonly declares: string[];
}

export interface NativeScanBatch extends NativeReadBatch {
  /** Every file represented by the columns, in their shared row order. */
  readonly files: string[];
  /** Parse-only generation in the existing source-index format. */
  readonly parseSegment: Buffer;
  /** Repository-relative target per request, or an empty string when unresolved. */
  readonly targets: string[];
}

export interface NativeScanner {
  gitTree(root: string): NativeGitTree | null;
  gitTreeFor(root: string, dirs: string[]): NativeGitTree | null;
  /** Every readable file below the configured roots, using bounded native I/O. */
  seedFiles(root: string, dirs: string[]): string[];
  /**
   * Read, parse and extract every one of `files` under `root`, across all cores.
   *
   * Paths are repository-relative, the answer is in the order asked, and
   * resolution is not included — a specifier comes back as it was written.
   */
  readBatch(
    root: string,
    files: string[],
    largestFile?: number,
    digests?: boolean,
    readers?: number,
  ): NativeReadBatch;
  /** Read, parse, extract and resolve one frontier without an AST crossing N-API. */
  scanBatch(
    root: string,
    files: string[],
    largestFile?: number,
    digests?: boolean,
    readers?: number,
    tsconfig?: string,
    conditionNames?: string[],
  ): NativeScanBatch;
  /** The kind names, indexed by the codes a batch's `kinds` carries. */
  kinds(): EdgeKind[];
}

let loaded: NativeScanner | undefined | null;

/** The addon, or nothing when this checkout has no `cargo` or did not build it. */
export function native(): NativeScanner | undefined {
  if (loaded !== undefined) return loaded ?? undefined;

  try {
    const require = createRequire(import.meta.url);
    loaded = require('../dist/native/scan.node') as NativeScanner;
  } catch {
    loaded = null;
  }

  return loaded ?? undefined;
}

/** Whether the native scanner is available, for a test that must say which ran. */
export function nativeAvailable(): boolean {
  return native() !== undefined;
}

export interface NativeFrontierOptions extends ResolveOptions {
  readonly addon: NativeScanner;
  readonly tree?: NativeGitTree;
  readonly root: string;
  readonly files: readonly string[];
  readonly largestFile: number;
  readonly digests: readonly (Digest | undefined)[];
  readonly aliases: Aliases | undefined;
  readonly directories: ReadonlyMap<string, Digest>;
  readonly remembering: boolean;
}

export interface NativeBuilt {
  readonly record: FileRecord;
  readonly witnesses: readonly string[];
  readonly read?: Parsed;
}

/**
 * Read, parse and resolve all files before returning to JavaScript.
 *
 * The JSON column is not a second format: it is the transient representation of
 * `Parsed` needed by the existing source-index encoder and callback. Records and
 * witnesses are assembled directly into their existing TypeScript shapes.
 */
export function nativeFrontier(options: NativeFrontierOptions): readonly NativeBuilt[] {
  const digestContents = options.digests.some((digest) => digest === undefined);
  const scan = options.tree?.scanBatch.bind(options.tree) ?? options.addon.scanBatch.bind(options.addon);
  const batch = scan(
    options.root,
    [...options.files],
    options.largestFile,
    digestContents,
    undefined,
    options.tsconfig,
    options.conditionNames === undefined ? undefined : [...options.conditionNames],
  );
  return builtFromBatch(options, batch);
}

export interface NativeGraphBuilt {
  readonly built: readonly NativeBuilt[];
  readonly parseLayer?: { readonly bytes: Uint8Array; readonly keys: ReadonlySet<string> };
}

/** Follow a cold module closure on one native side of the boundary. */
export function nativeGraph(
  options: NativeFrontierOptions,
  includeParses = false,
): NativeGraphBuilt {
  if (options.tree === undefined) return { built: nativeFrontier(options) };
  const batch = options.tree.scanGraph(
    options.root,
    [...options.files],
    options.largestFile,
    undefined,
    options.tsconfig,
    options.conditionNames === undefined ? undefined : [...options.conditionNames],
    includeParses,
  );
  const digests = options.tree
    .digestsFor(batch.files)
    .map((digest) => digest === '' ? undefined : digest as Digest);
  const built = builtFromBatch({ ...options, files: batch.files, digests }, batch);
  const keys = new Set<string>();
  for (const [index, file] of batch.files.entries()) {
    if (batch.parsed[index] !== 1) continue;
    const digest = digests[index] ?? asDigest(batch.digests[index]);
    if (digest !== undefined) keys.add(keyFor(digest, parseWay(file)));
  }
  return {
    built,
    ...(batch.parseSegment.byteLength === 0
      ? {}
      : { parseLayer: { bytes: batch.parseSegment, keys } }),
  };
}

function builtFromBatch(
  options: NativeFrontierOptions,
  batch: NativeScanBatch,
): readonly NativeBuilt[] {
  const kinds = options.addon.kinds();
  const built: NativeBuilt[] = [];
  let at = 0;
  let declareAt = 0;

  for (const [index, file] of options.files.entries()) {
    const count = batch.counts[index] ?? 0;
    const declareCount = batch.declareCounts[index] ?? 0;
    const declares = batch.declares.slice(declareAt, declareAt + declareCount);
    declareAt += declareCount;
    const encoded = batch.parses[index] ?? '';
    if (batch.parsed[index] !== 1) {
      built.push({
        record: {
          file,
          ...(batch.unknown[index] === '' ? {} : { unknown: batch.unknown[index] }),
        },
        witnesses: [],
      });
      at += count;
      continue;
    }
    const digest = options.digests[index] ?? asDigest(batch.digests[index]);

    const read = encoded === '' ? undefined : JSON.parse(encoded) as Parsed;
    const edges: FileEdge[] = [];
    const unresolved: string[] = [];
    const holes: string[] = [];
    const requests: string[] = [];
    for (let step = 0; step < count; step += 1) {
      const value = batch.values[at + step] ?? '';
      requests.push(value);
      const request = requestOf(value);
      if (request === undefined) continue;
      const target = batch.targets[at + step] ?? '';
      if (target === '') {
        unresolved.push(value);
        if (isRelative(request)) holes.push(value);
        continue;
      }
      const kind = kinds[batch.kinds[at + step] ?? -1];
      if (kind !== undefined) edges.push({ to: target, kind: kindFor(kind, target) });
    }
    at += count;

    const reasons = [
      ...(batch.unknown[index] === '' ? [] : [batch.unknown[index]!]),
      ...(holes.length === 0
        ? []
        : [`${holes.length} relative specifier(s) that resolve to nothing: ${holes.join(', ')}`]),
    ];
    const settled = dedupe(edges);
    const record: FileRecord = {
      file,
      ...(digest === undefined ? {} : { digest }),
      ...(settled.length === 0 ? {} : { edges: settled }),
      ...(declares.length === 0 ? {} : { declares }),
      ...(unresolved.length === 0
        ? {}
        : { unresolved: [...new Set(unresolved)].sort(byCodeUnit) }),
      ...(reasons.length === 0 ? {} : { unknown: `${file} — ${reasons.join('; ')}` }),
    };
    const witnesses = options.remembering
      ? witnessesOf({
        file,
        requests,
        edges: settled.map((edge) => edge.to),
        directories: options.directories,
        aliases: options.aliases,
      })
      : [];
    built.push({
      record,
      ...(read === undefined ? {} : { read }),
      witnesses,
    });
  }

  return built;
}

function asDigest(value: string | undefined): Digest | undefined {
  return value === undefined || value === '' ? undefined : value;
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
