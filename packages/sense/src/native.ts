/**
 * The native scanner, when one arrived for this machine.
 *
 * It is an acceleration of the TypeScript scanner and never a replacement for
 * it: every answer it gives, the JavaScript path gives too, and the differential
 * tests are what say so. So a missing addon is not a degraded mode to warn
 * about — it is the implementation of record, running. That is what makes a
 * three-platform matrix a defensible thing to ship: a machine outside it is
 * slower and never wrong.
 *
 * Loading it is [`addon.ts`](./addon.ts), apart from everything here, because
 * the instrument loads it inside every test worker and the scanner's imports
 * are nothing a worker needs.
 */

import type { EdgeKind, FileEdge, FileRecord, PackageEdge } from '@variance-authority/core/relate';
import type { Parsed } from './cache.js';
import type { Digest } from './digest.js';
import type { NativeInstrumented } from './instrument/spliced.js';
import { keyFor, parseWay } from './files.js';
import { type ResolveOptions } from './resolve.js';
import { isRelative, kindFor, packageOf, requestOf } from './specifier.js';
import type { Aliases } from './witness.js';
import { witnessesOf } from './witness.js';

export { PLATFORMS, native, nativeAvailable, nativeRefusal, refusal } from './addon.js';

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
  /** `instrument()`'s walk and splice, or `null` for a source that does not parse. */
  instrument(source: string, file: string, entries: boolean): NativeInstrumented | null;
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
  /**
   * What one file of a tree-sitter language asks for and publishes, as `Read` JSON.
   *
   * One file rather than a batch, because this crosses the boundary from inside
   * the parse cache — the caller is a synchronous reader holding one file's
   * bytes, and the batching that the module path does happens a layer above it.
   * Nothing when the addon does not claim the language — which is every
   * language on a binary built without the tree-sitter grammars, the fallback
   * `native/build.mjs` takes when they are what failed to compile.
   */
  readLanguage(language: string, file: string, source: string): string | null;
  /** Read, fold, and encode one run's case journals without crossing rows into V8. */
  foldJourney?(
    caseDirectory: string,
    root: string,
    stores: string[],
    instrumentation: string,
    budgetMegabytes?: number,
  ): NativeJourneyFold;
  /** Fold and write the compressed artifact without returning its bytes to JavaScript. */
  foldJourneyTo?(
    caseDirectory: string,
    root: string,
    stores: string[],
    instrumentation: string,
    output: string,
    budgetMegabytes?: number,
  ): NativeJourneyFoldResult;
  /** Union compressed journey artifacts while their crossing relation stays native. */
  stitchJourneys?(files: string[]): NativeJourneyStitch;
  /** Union and write compressed journey artifacts without returning their bytes to JavaScript. */
  stitchJourneysTo?(files: string[], output: string): NativeJourneyStitchResult;
  /** A journey file cut down to the changed modules, with cases only on the regions the change can ask about. */
  projectJourneys?(file: string, changed: NativeJourneyChange[]): NativeJourneyProjection;
  /** The test files a change needs, read off a journey file and the file graph; unsorted. */
  selectJourneys?(
    file: string,
    changed: NativeJourneyChange[],
    graph?: NativeJourneyGraph,
    packages?: string[],
  ): NativeJourneySelection;
}

/** `Relations`, flattened to the columns the addon walks. */
export interface NativeJourneyGraph {
  readonly names: readonly string[];
  readonly kinds: Uint8Array;
  readonly dependsOffset: Uint32Array;
  readonly dependsTarget: Uint32Array;
  readonly dependsKind: Uint8Array;
  readonly dependentsOffset: Uint32Array;
  readonly dependentsTarget: Uint32Array;
  readonly dependentsKind: Uint8Array;
  /** The `EDGE_KINDS` indices a runtime walk follows. */
  readonly through: readonly number[];
  readonly shadows: readonly { readonly file: string; readonly shadows: readonly string[] }[];
}

export interface NativeJourneySelection {
  readonly whole: readonly string[];
  readonly entered: readonly string[];
  readonly unread: readonly string[];
}

export interface NativeJourneyChange {
  readonly file: string;
  /** Flat inclusive `[start, end]` pairs; empty names the whole file. */
  readonly ranges: number[];
}

export interface NativeJourneyProjection {
  readonly tests: readonly { readonly id: string; readonly file: string; readonly name: string }[];
  readonly modules: readonly {
    readonly file: string;
    readonly blocks: readonly {
      readonly kind: string;
      readonly name: string;
      readonly path: string;
      readonly startLine: number;
      readonly endLine: number;
      readonly source: boolean;
      readonly loaded: boolean;
      readonly tests: readonly number[];
    }[];
  }[];
  /** Every file the journey holds a row for. */
  readonly files: readonly string[];
}

export interface NativeJourneyFold {
  readonly bytes: Buffer;
  readonly tests: number;
  readonly modules: number;
  readonly crossings: number;
  readonly passes: number;
  /** Files two builds cut into different regions, read at the regions both hold. */
  readonly renumbered: readonly string[];
}

export type NativeJourneyFoldResult = Omit<NativeJourneyFold, 'bytes'>;

export interface NativeJourneyStitch {
  readonly bytes: Buffer;
  readonly tests: number;
  readonly modules: number;
  readonly crossings: number;
  readonly shards: number;
  /** Files two shards cut into different regions, read at the regions both hold. */
  readonly renumbered: readonly string[];
}

export type NativeJourneyStitchResult = Omit<NativeJourneyStitch, 'bytes'>;

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
  readonly targets?: readonly (string | undefined)[];
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
  const started = performance.now();
  const batch = scan(
    options.root,
    [...options.files],
    options.largestFile,
    digestContents,
    undefined,
    options.tsconfig,
    options.conditionNames === undefined ? undefined : [...options.conditionNames],
  );
  if (process.env['VARIANCE_SENSE_TIMINGS'] === '1') {
    process.stderr.write(`sense native scan: ${(performance.now() - started).toFixed(1)} ms\n`);
  }
  const crossing = performance.now();
  const built = builtFromBatch(options, batch);
  if (process.env['VARIANCE_SENSE_TIMINGS'] === '1') {
    process.stderr.write(`sense native crossing: ${(performance.now() - crossing).toFixed(1)} ms\n`);
  }
  return built;
}

export interface NativeGraphBuilt {
  readonly built: readonly NativeBuilt[];
  readonly parseLayer?: { readonly bytes: Uint8Array; readonly keys: Set<string> };
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
    const packages: PackageEdge[] = [];
    const unresolved: string[] = [];
    const holes: string[] = [];
    const requests: string[] = [];
    const targets: (string | undefined)[] = [];
    for (let step = 0; step < count; step += 1) {
      const value = batch.values[at + step] ?? '';
      requests.push(value);
      const target = batch.targets[at + step] ?? '';
      targets.push(target === '' ? undefined : target);
      const request = requestOf(value);
      if (request === undefined) continue;
      const kind = kinds[batch.kinds[at + step] ?? -1];
      if (target === '') {
        unresolved.push(value);
        // The package edge the oracle records beside it ([`record.ts`](./record.ts)).
        // Without it a bumped package has no importer in a graph this path
        // built, and the install walk selects nothing for it.
        const named = packageOf(request);
        if (named !== undefined && kind !== undefined) packages.push({ to: named, kind });
        if (isRelative(request)) holes.push(value);
        continue;
      }
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
      ...(packages.length === 0 ? {} : { packages: dedupe(packages) }),
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
      targets,
      witnesses,
    });
  }

  return built;
}

function asDigest(value: string | undefined): Digest | undefined {
  return value === undefined || value === '' ? undefined : value;
}

function dedupe<Edge extends FileEdge>(edges: readonly Edge[]): readonly Edge[] {
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
