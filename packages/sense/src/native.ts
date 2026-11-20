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
import type { EdgeKind, FileRecord } from '@variance-authority/core/relate';
import type { Parsed } from './cache.js';
import type { Digest } from '@variance-authority/core/format';
import type { NativeInstrumented, NativePlaced } from './instrument/spliced.js';
import { keyFor, parseWay } from './files.js';
import type { ResolveOptions } from './resolve.js';
import { builtFromBatch, recordOptions } from './native-built.js';
import type { NativeIndexGraph, NativeIndexGraphOptions } from './native-index-graph.js';
import type {
  NativeJourneyGraph, NativeJourneySelection, NativeJourneyChange,
  NativeJourneyProjection, NativeJourneyFold, NativeJourneyFoldResult,
  NativeJourneyModule, NativeJourneyStitch, NativeJourneyStitchResult, NativeCaseJournals,
  NativeCaseCut, NativeCaseEdit, NativeCaseLayers, NativeCaseRegion, NativeCaseRunFiles,
} from './native-journey.js';
import type { NativeCasesEntered, NativeDependencyLexicon, NativeExternalOrientation, NativeOrientation, NativeOrientMapListing, NativeOrientMaps } from './native-orient.js';
import type { NativeCommitTexts } from './native-commit-text.js';
import type { NativeSourceIndexes } from './native-source-index.js';
import type { NativeDistill } from './native-distill.js';
import type { NativeSaid } from './native-said.js';
import type { NativeJourneys, NativeJourneysListing } from './native-journeys.js';
import type { NativeRecords } from './native-record.js';
import type { NativeModuleReaders, NativeModuleReferences, NativeModuleVerdict } from './native-module-reads.js';
import type { NativeUpdateOptions, NativeUpdated } from './native-update.js';
/** Every tracked path under a root, with the digest of the bytes on disk. */
export interface NativeGitTree extends NativeOrientMapListing, NativeJourneysListing {
  readonly size: number;
  /** Watchman vouched for the listing the index held, and git listed nothing (`native/src/change_tree.rs`). */
  readonly vouched: boolean;
  /** Git compared only what Watchman reports moved since the listing the index held (`native/src/held_listing.rs`). */
  readonly followed: boolean;
  seeds(): string[];
  has(path: string): boolean;
  digest(path: string): string | null;
  digestsFor(paths: string[]): string[];
  /** The parses the `stores` a scan read hold for `files` at `digests`, as a parse-only segment. */
  keptParses(stores: string[], files: string[], digests: string[]): Uint8Array;
  scanBatch(
    root: string,
    files: string[],
    largestFile?: number,
    digests?: boolean,
    readers?: number,
    tsconfig?: string | false,
    conditionNames?: string[],
    stores?: string[],
    records?: NativeRecordOptions,
    held?: Uint8Array,
  ): NativeScanBatch;
  scanGraph(
    root: string,
    seeds: string[],
    largestFile?: number,
    readers?: number,
    tsconfig?: string | false,
    conditionNames?: string[],
    includeParses?: boolean,
    stores?: string[],
    records?: NativeRecordOptions,
    held?: Uint8Array,
  ): NativeScanBatch;
  /** A cold closure held on the native side ([`native-index-graph.ts`](./native-index-graph.ts)). */
  indexGraph(options: NativeIndexGraphOptions): NativeIndexGraph;
  /** An update of the source index on the native side ([`native-update.ts`](./native-update.ts)). */
  updateIndex(options: NativeUpdateOptions): NativeUpdated;
  paths(): string[];
  digests(): string[];
  named(names: string[]): string[];
  directories(): Record<string, string>;
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
  /** One when the reader guessed the request, so a miss is silence rather than a hole. */
  readonly guessed: Buffer;
}
/** `RecordOptions` in `native/src/record.rs`: what a batch's records are settled against. */
export interface NativeRecordOptions {
  readonly remembering: boolean;
  readonly builtins: string[];
  readonly codeExtensions: string[];
  readonly directories: string[];
  /** The digest each asked file is named by, empty where the read's names it. */
  readonly identities?: string[];
}
export interface NativeScanBatch extends Omit<NativeReadBatch, 'guessed'> {
  /** Every file represented by the columns, in their shared row order. */
  readonly files: string[];
  /** Parse-only generation in the existing source-index format. */
  readonly parseSegment: Buffer;
  /** Repository-relative target per request, or an empty string when unresolved. */
  readonly targets: string[];
  /**
   * One when the parse came from the cache's parse store rather than from the
   * bytes: the file was not opened, and its `parses` row is empty because the
   * store holds the parse whole ([`parse-store.ts`](./parse-store.ts)).
   */
  readonly kept: Buffer;
  /** Every row's `IndexedRecord` as JSON, built by `built` in `record.rs`, when records were asked for. */
  readonly records?: string;
}

export interface NativeScanner extends NativeOrientMaps, NativeDependencyLexicon, NativeJourneys, NativeRecords, NativeDistill, NativeSaid, NativeCommitTexts, NativeSourceIndexes {
  /**
   * `instrument()`'s walk and splice, or `null` for a source that does not
   * parse. With a `module`, the header reporting under it is in the text.
   */
  instrument(source: string, file: string, entries: boolean, module?: string): NativeInstrumented | null;
  /** `authored`'s regions placed in `transformed` through `mappings`: `native/instrument/src/place.rs`. */
  place(...args: [string, string, string, string, number, boolean, string, boolean]): NativePlaced | null;
  /** The header one module carries: `native/instrument/src/header.rs`. */
  probeHeader(module: string, count: number): string;
  /** The instrumenter crate's `recipe()` for `presence`, or for `entries`. */
  probeRecipe(entries: boolean): string;
  /**
   * The test file with a cut before each statement of its test and hook
   * bodies, the `mappings` back to `source` and the `[line, column, length]`
   * shifts they were made from, or `null`: `native/instrument/src/cadence.rs`.
   */
  cadence(source: string, file: string, awaited?: boolean): { code: string; mappings: string; shifts: number[] } | null;
  /**
   * For each `.profraw` in `profiles`, the files under `root` its run of
   * `binaries` entered: each a module id and the ordinals of the Rust reader's
   * regions its counters reached, or `null` for a profile missing, empty or cut
   * short (`native/src/rust_coverage.rs`).
   */
  rustCoverage(binaries: string[], profiles: string[], root: string): ({ id: string; ordinals: Uint32Array }[] | null)[];
  gitTree(root: string): NativeGitTree | null;
  gitTreeFor(root: string, dirs: string[]): NativeGitTree | null;
  /** The tree an update of the index at `index` is made against (`native/src/change_tree.rs`). */
  changeTree(root: string, index: string, dirs: string[]): NativeGitTree | null;
  /** The tree of a directory git does not list, read off the disk (`native/src/change_tree.rs`). */
  diskTree(root: string, dirs: string[]): NativeGitTree;
  /** The first of `others` an update with no chain to stand on starts from under `config` (`native/src/source_update_seed.rs`). */
  sourceIndexSeed(others: string[], config: string): string | null;
  /** The format version the segment at `path` names in its header, read off its first bytes (`native/src/index_reader.rs`). */
  sourceIndexSegmentVersion(path: string): number | null;
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
   * `listed` is Git's listing when the tree is not the addon's own: a module
   * under a tracked `build/` lands only when listed, and the other languages
   * resolve against it. Without it they ask the disk, walked once per batch,
   * which enters a repository of its own only when it is one of `dirs`, or
   * holds one. A file whose parse `held` holds is answered from it unopened.
   */
  scanBatch(
    root: string,
    files: string[],
    largestFile?: number,
    digests?: boolean,
    readers?: number,
    tsconfig?: string | false,
    conditionNames?: string[],
    listed?: string[],
    records?: NativeRecordOptions,
    dirs?: string[],
    held?: Uint8Array,
  ): NativeScanBatch;
  /** The kind names, indexed by the codes a batch's `kinds` carries. */
  kinds(): EdgeKind[];
  /**
   * What one file of a tree-sitter language asks for and publishes, as `Read` JSON.
   *
   * One file rather than a batch, for a test that holds one file's bytes: a
   * scan reads every language through the batch. It takes no path, because a
   * read is shared by every file holding the same bytes and names none of them.
   * Nothing when the addon does not claim the language: every language on a
   * binary built without the grammars, which `native/build.mjs` falls back to.
   */
  readLanguage(language: string, source: string): string | null;
  /** Each path's text digest, as `digestString(readFile(path, 'utf8'))` has it, read in parallel; throws naming the first it cannot read. */
  textDigests?(paths: string[]): string[];
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
   * `listed` names the files the caller's graph holds under a tracked `build/` ([`repo-path.ts`](./repo-path.ts)); `tsconfig`, the one the scan that built it resolved under ([`typescript.ts`](./typescript.ts)).
   */
  resolveSources?(root: string, file: string, sources: string[], listed?: string[], tsconfig?: string | false): string[];
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
  /** One run's case index laid over the one it replaces, and the before it retired: `native/src/case_layer.rs`. */
  layerCaseIndex?(previous: Uint8Array | undefined, fresh: Uint8Array, files: NativeCaseRunFiles, edit?: (file: string) => NativeCaseEdit | undefined): NativeCaseLayers;
  /** What the runs at one commit retired, as one before: `retired` laid over `kept`. */
  layerCaseBefore?(kept: Uint8Array | undefined, retired: Uint8Array | undefined, ran: string[]): Buffer | null;
  /** The case index with each module `cuts` names laid onto that cut; `null` when every one already stands at it. `edit` is asked only of a module laid onto another cut. */
  followCaseCuts?(index: Uint8Array, cuts: NativeCaseCut[], edit: (file: string) => NativeCaseEdit | undefined): Buffer | null;
  /** Whether a case index's cut of a module stands at other text than a snapshot row's cut of it: `native/src/case_layer_landing.rs`. */
  caseCutApart?(index: readonly NativeCaseRegion[], snapshot: readonly NativeCaseRegion[]): boolean;
  /** Read a run's case journals for the case index a reporter lays. */
  openCaseJournals?(directory: string, root: string): NativeCaseJournals;
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
  /** The parse stores a tracked file is looked up in before it is opened; only a `tree` reads them. */
  readonly stores?: readonly string[];
  /** Without `tree`, every file the listing holds; without either, the batch walks the disk. */
  readonly listed?: readonly string[];
  /** The directories the scan was asked for: a walk of the disk enters a repository of its own among them. */
  readonly dirs?: readonly string[];
  /** A parse-only segment of what the caller's cache holds for `files` at `digests`: those are not opened. */
  readonly held?: Uint8Array;
  readonly root: string;
  readonly files: readonly string[];
  readonly largestFile: number;
  readonly digests: readonly (Digest | undefined)[];
  readonly directories: ReadonlyMap<string, Digest>;
  readonly remembering: boolean;
}

export interface NativeBuilt {
  readonly record: FileRecord;
  readonly witnesses: readonly string[];
  readonly targets?: readonly (string | undefined)[];
  readonly read?: Parsed;
  /** The bytes were parsed by this call, rather than kept or declined. */
  readonly parsed?: true;
  /** The parse is the cache's or its store's, and not in `read`: the cache keeps it from there. */
  readonly kept?: true;
}

/**
 * Read, parse and resolve all files before returning to JavaScript.
 *
 * The JSON column is not a second format: it is the transient representation of
 * `Parsed` needed by the existing source-index encoder and callback. Records and
 * witnesses are built on the native side (`record.rs`) and only decoded here.
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
      recordOptions(options, options.digests),
      options.dirs === undefined ? undefined : [...options.dirs],
      options.held,
    )
    : options.tree.scanBatch(
      options.root,
      [...options.files],
      options.largestFile,
      digestContents,
      undefined,
      options.tsconfig,
      conditionNames,
      options.stores === undefined ? undefined : [...options.stores],
      recordOptions(options, options.digests),
      options.held,
    );
  if (process.env['VARIANCE_SENSE_TIMINGS'] === '1') {
    process.stderr.write(`sense native scan: ${(performance.now() - started).toFixed(1)} ms\n`);
  }
  const crossing = performance.now();
  const built = builtFromBatch(batch);
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
    options.stores === undefined ? undefined : [...options.stores],
    recordOptions(options),
    options.held,
  );
  const built = builtFromBatch(batch);
  const keys = new Set<string>();
  for (const [index, file] of batch.files.entries()) {
    // A kept row is not in the segment: the store holds its parse. A parsed
    // row's record is named by the walk's identity, as its parse is.
    if (batch.parsed[index] !== 1 || batch.kept[index] === 1) continue;
    const digest = built[index]!.record.digest;
    if (digest !== undefined) keys.add(keyFor(digest, parseWay(file)));
  }
  return {
    built,
    ...(batch.parseSegment.byteLength === 0
      ? {}
      : { parseLayer: { bytes: batch.parseSegment, keys } }),
  };
}
