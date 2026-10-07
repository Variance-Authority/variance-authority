/**
 * The native scanner, when one arrived for this machine.
 *
 * It is the only module reader: [`readModule`](./read.ts) calls it for text
 * already in hand, and the batch calls here read files off the disk. A machine
 * the addon did not reach cannot read a module and says why, naming the
 * refusal, rather than reading it some other way. The graph around the reader —
 * resolution and the record — still has a JavaScript path, and the differential
 * tests hold the two to one answer.
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
import type { Aliases, AliasTable } from './witness.js';
import type { NativeIndexGraph, NativeIndexGraphOptions } from './native-index-graph.js';
import type {
  NativeJourneyGraph, NativeJourneySelection, NativeJourneyChange,
  NativeJourneyProjection,
  NativeJourneyFold,
  NativeJourneyFoldResult,
  NativeJourneyModule,
  NativeJourneyStitch,
  NativeJourneyStitchResult,
} from './native-journey.js';
import type { NativeCasesEntered, NativeDependencyLexicon, NativeExternalOrientation, NativeOrientation, NativeOrientMapListing, NativeOrientMaps } from './native-orient.js';
import type { NativeJourneys, NativeJourneysListing } from './native-journeys.js';
import type { NativeCoverageLookups } from './native-coverage-lookup.js';
import { witnessesOf } from './witness.js';
export { PLATFORMS, native, nativeAvailable, nativeRefusal, refusal } from './addon.js';
export type {
  NativeJourneyGraph,
  NativeJourneySelection,
  NativeJourneyChange,
  NativeJourneyProjection,
  NativeJourneyFold,
  NativeJourneyFoldResult,
  NativeJourneyModule,
  NativeJourneyStitch,
  NativeJourneyStitchResult,
} from './native-journey.js';
import type { NativeModuleReaders, NativeModuleReferences, NativeModuleVerdict } from './native-module-reads.js';
export type { NativeModuleReaders, NativeModuleReferences, NativeModuleVerdict };
import type { NativeUpdateOptions, NativeUpdated } from './native-update.js';
/** Every tracked path under a root, with the digest of the bytes on disk. */
export interface NativeGitTree extends NativeOrientMapListing, NativeJourneysListing {
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
  /** A cold closure held on the native side ([`native-index-graph.ts`](./native-index-graph.ts)). */
  indexGraph(options: NativeIndexGraphOptions): NativeIndexGraph;
  /** A warm update of the source index on the native side; `null` when the JavaScript update has to ([`native-update.ts`](./native-update.ts)). */
  updateIndex?(options: NativeUpdateOptions): NativeUpdated | null;
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
  /**
   * One when the bytes decided the file is not parsed — over the size the scan
   * opens, or not UTF-8 — rather than a read that failed.
   */
  readonly declined: Buffer;
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

export interface NativeScanner extends NativeOrientMaps, NativeDependencyLexicon, NativeJourneys, NativeCoverageLookups {
  /** `instrument()`'s walk and splice, or `null` for a source that does not parse. */
  instrument(source: string, file: string, entries: boolean): NativeInstrumented | null;
  gitTree(root: string): NativeGitTree | null;
  /**
   * The alias table the `tsconfig` and `jsconfig` files among `paths` declare,
   * read from `root`: `native/src/witness_aliases.rs`. `null` when one of them
   * cannot be read.
   */
  aliasesIn(root: string, paths: string[]): AliasTable | null;
  /**
   * A source-index generation as bytes, from the JSON documents
   * `sourceIndexDocuments` writes of it. The only encoder of the format.
   */
  encodeSourceIndex(documents: string[]): Buffer;
  /**
   * Write a save's `layers` over the source-index chain at `path`, as the save
   * read it: the first `read.length` segments its manifest names, or the legacy
   * single-segment file when `legacy`. The addon decides what the next manifest
   * names (`native/src/append_index.rs`) and is the only writer of the chain.
   * Why the layers were not written, or `null` when they are.
   */
  appendSourceIndex(path: string, read: string[], legacy: boolean, layers: Uint8Array[]): string | null;
  /** Start the chain at `path` as a copy of the one at `from`, when `path` has none; whether it did. */
  seedSourceIndex(path: string, from: string): boolean;
  /** The machine's index turn at `path`, `holder` written beside it; `null` while another process holds it (`native/src/index_turn.rs`). */
  takeIndexTurn(path: string, holder: string): { release(): void } | null;
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
  /**
   * Read, parse, extract and resolve one frontier without an AST crossing N-API.
   * `listed` names the files under a tracked `build/` when the tree is not the
   * addon's own ([`repo-path.ts`](./repo-path.ts)).
   */
  scanBatch(
    root: string,
    files: string[],
    largestFile?: number,
    digests?: boolean,
    readers?: number,
    tsconfig?: string,
    conditionNames?: string[],
    listed?: string[],
  ): NativeScanBatch;
  /** The kind names, indexed by the codes a batch's `kinds` carries. */
  kinds(): EdgeKind[];
  /**
   * What one file of a tree-sitter language asks for and publishes, as `Read` JSON.
   *
   * One file rather than a batch, because this crosses the boundary from inside
   * the parse cache — the caller is a synchronous reader holding one file's
   * bytes, and the batching that the module path does happens a layer above it.
   * Nothing when the addon does not claim the language: every language on a
   * binary built without the grammars, which `native/build.mjs` falls back to.
   */
  readLanguage(language: string, file: string, source: string): string | null;
  /** A `Package.swift`'s targets as JSON `[{ name, path }]`; `null` unparsed or without grammars. */
  swiftTargets(source: string): string | null;
  /** One module's parse, as JSON, for source text already in hand. */
  readSource(file: string, source: string): string;
  /**
   * What one change to a module does when the module loads, read from both
   * texts: `none`, `bodies`, `values` with the bindings whose values moved, or
   * `load`. `null` when either text does not parse.
   */
  moduleVerdict?(file: string, before: string, after: string): NativeModuleVerdict | null;
  /**
   * Where one file reads the given names: its own bindings, or when
   * `imported`, the exports of a module it imports. `null` when it does not parse.
   */
  moduleReaders?(file: string, text: string, names: string[], imported: boolean): NativeModuleReaders | null;
  /**
   * Where one file references what it imports, by the specifier each import names, and whether each
   * reference runs when the file loads. A name in a type position is no reference. `null` when it does not parse.
   */
  moduleReferences?(file: string, text: string): NativeModuleReferences | null;
  /**
   * Where each source `file` imports from lands: a repository path, an absolute path outside it, or `''`.
   * `listed` names the files the caller's graph holds under a tracked `build/` ([`repo-path.ts`](./repo-path.ts)).
   */
  resolveSources?(root: string, file: string, sources: string[], listed?: string[]): string[];
  /**
   * Fetch in one request the blobs at `commit` of `paths` a partial clone has not fetched yet.
   * `false` when no remote promised any, so a path a read found missing is absent.
   */
  fetchMissingAt?(root: string, commit: string, paths: string[]): boolean;
  /** Of these files, those whose nearest `package.json` declares that loading them does something. */
  declaredEffects?(root: string, files: string[]): string[];
  /** Every module id a run's cases and parts name, for the caller to cut again with `deriveModules`. */
  journeyModuleIds?(caseDirectory: string, root: string, parts?: string[]): string[];
  /** Read, fold, and encode one run's case journals without crossing rows into V8. */
  foldJourney?(
    caseDirectory: string,
    root: string,
    modules: NativeJourneyModule[],
    budgetMegabytes?: number,
  ): NativeJourneyFold;
  /** Fold and write the compressed artifact without returning its bytes to JavaScript. */
  foldJourneyTo?(
    caseDirectory: string,
    root: string,
    modules: NativeJourneyModule[],
    output: string,
    budgetMegabytes?: number,
    parts?: string[],
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
    declines?: boolean,
  ): NativeJourneySelection;
  /** The packages `files` belong to and the names crossing their edges, read off the source index at `index`; `null` when none was published. */
  orientPackages?(root: string, index: string, files: string[], rows: number, names: number): NativeOrientation | null;
  /** Both of the above from one read of the chain and one listing of the tree; `null` when no index is published. */
  orientAround?(root: string, index: string, files: string[], packageRows: number, packageNames: number, externalRows: number, externalSites: number): { packages: NativeOrientation; external: NativeExternalOrientation } | null;
  /** Indexed external requests from `files`; `null` when no index is published. */
  externalDependencies?(root: string, index: string, files: string[], rows: number, sites: number): NativeExternalOrientation | null;
  /** For each of `files`, the cases in the journey file at `file` that ran it. */
  casesEntered?(file: string, files: string[], titles: number, index?: string | null): NativeCasesEntered[];
}

export interface NativeFrontierOptions extends ResolveOptions {
  readonly addon: NativeScanner;
  readonly tree?: NativeGitTree;
  /** Without `tree`, the files the listing holds under a tracked `build/`. */
  readonly listed?: readonly string[];
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
  const conditionNames = options.conditionNames === undefined ? undefined : [...options.conditionNames];
  const started = performance.now();
  // A tree the addon built resolves with its own listing; only the free batch
  // is told which `build/` files are listed.
  const batch = options.tree === undefined
    ? options.addon.scanBatch(
      options.root,
      [...options.files],
      options.largestFile,
      digestContents,
      undefined,
      options.tsconfig,
      conditionNames,
      options.listed === undefined ? undefined : [...options.listed],
    )
    : options.tree.scanBatch(
      options.root,
      [...options.files],
      options.largestFile,
      digestContents,
      undefined,
      options.tsconfig,
      conditionNames,
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
      // A file its bytes declined names them; a failed read names nothing, and
      // is tried again. `built` in `record.rs` is the same rule.
      const declined = batch.declined[index] === 1
        ? options.digests[index] ?? asDigest(batch.digests[index])
        : undefined;
      built.push({
        record: {
          file,
          ...(declined === undefined ? {} : { digest: declined }),
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
        // The package edge [`record.ts`](./record.ts) records beside it for every other language.
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
    built.push({ record, ...(read === undefined ? {} : { read }), targets, witnesses });
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
