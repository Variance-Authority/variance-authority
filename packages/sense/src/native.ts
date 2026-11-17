/**
 * The native scanner, when one arrived for this machine.
 *
 * It is the only module reader: [`readModule`](./read.ts) calls it for text
 * already in hand, and the batch calls here read files off the disk. A machine
 * the addon did not reach cannot read a module and says why, naming the
 * refusal, rather than reading it some other way. Source acquisition, parsing,
 * resolution and graph assembly stay in the addon.
 *
 * Loading it is [`addon.ts`](./addon.ts), apart from everything here, because
 * the instrument loads it inside every test worker and the scanner's imports
 * are nothing a worker needs.
 */
import type { EdgeKind } from '@variance-authority/core/relate';
import type { NativeInstrumented, NativePlaced } from './instrument/spliced.js';
import type { AliasTable } from './witness.js';
import type { NativeIndexGraph, NativeIndexGraphOptions, NativeScanSession } from './native-index-graph.js';
import type {
  NativeJourneyGraph, NativeJourneySelection, NativeJourneyChange,
  NativeJourneyProjection, NativeJourneyFold, NativeJourneyFoldResult,
  NativeJourneyModule, NativeJourneyStitch, NativeJourneyStitchResult, NativeCaseJournals,
  NativeCaseCut, NativeCaseEdit, NativeCaseLayers, NativeCaseRegion, NativeCaseRunFiles,
} from './native-journey.js';
import type { NativeCasesEntered, NativeDependencyLexicon, NativeDependencyLexiconListing, NativeExternalOrientation, NativeOrientation, NativeOrientMapListing, NativeOrientMaps } from './native-orient.js';
import type { NativeCommitTexts } from './native-commit-text.js';
import type { NativeParseOrigins, NativeSourceIndexes } from './native-source-index.js';
import type { NativeDistill } from './native-distill.js';
import type { NativeSaid } from './native-said.js';
import type { NativeJourneys, NativeJourneysListing } from './native-journeys.js';
import type { NativeRecords } from './native-record.js';
import type { NativeModuleReaders, NativeModuleReferences, NativeModuleVerdict } from './native-module-reads.js';
import type { NativeUpdateOptions, NativeUpdated } from './native-update.js';
import type { NativeHelpListing } from './help-reading.js';
/** Every tracked path under a root, with the digest of the bytes on disk. */
export interface NativeGitTree extends NativeOrientMapListing, NativeJourneysListing, NativeParseOrigins, NativeDependencyLexiconListing, NativeHelpListing {
  readonly size: number;
  /** Watchman vouched for the listing the index held, and git listed nothing (`native/src/change_tree.rs`). */
  readonly vouched: boolean;
  /** Filesystem paths outside Git have no content identity until their native read. */
  readonly filesystem: boolean;
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
    tsconfig?: string | false,
    conditionNames?: string[],
    stores?: string[],
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
  ): NativeScanBatch;
  /** A cold closure held on the native side ([`native-index-graph.ts`](./native-index-graph.ts)). */
  indexGraph(options: NativeIndexGraphOptions, session?: NativeScanSession): NativeIndexGraph;
  /** The native source-index lifecycle; `null` when its options are refused ([`native-update.ts`](./native-update.ts)). */
  updateIndex?(options: NativeUpdateOptions): NativeUpdated | null;
  paths(): string[];
  digests(): string[];
  named(names: string[]): string[];
  aliasesIn(paths: string[]): AliasTable | null;
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
  /**
   * One when the parse came from the cache's parse store rather than from the
   * bytes: the file was not opened, and its `parses` row is empty because the
   * store holds the parse whole ([`parse-store.ts`](./parse-store.ts)).
   */
  readonly kept: Buffer;
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
  gitTree(root: string): NativeGitTree | null;
  /**
   * The alias table the `tsconfig` and `jsconfig` files among `paths` declare,
   * read from `root`: `native/src/witness_aliases.rs`. `null` when one of them
   * cannot be read.
   */
  aliasesIn(root: string, paths: string[]): AliasTable | null;
  gitTreeFor(root: string, dirs: string[]): NativeGitTree | null;
  gitTreeForChanged(root: string, dirs: string[], changed: string[]): NativeGitTree | null;
  /** A native source tree outside Git, or for a scan that opens files from disk. */
  filesystemTree(root: string, dirs: string[]): NativeGitTree;
  /** The caller's exact source membership and seeds, acquired and resolved natively. */
  sourceTree(root: string, paths: string[], seeds: string[]): NativeGitTree;
  /** One scan's native Rust facts, reused only across its own frontiers. */
  newScanSession(parses?: Uint8Array): NativeScanSession;
  /** The tree an update of the index at `index` is made against (`native/src/change_tree.rs`). */
  changeTree(root: string, index: string, dirs: string[]): NativeGitTree | null;
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
    tsconfig?: string | false,
    conditionNames?: string[],
    listed?: string[],
  ): NativeScanBatch;
  /** The kind names, indexed by the codes a batch's `kinds` carries. */
  kinds(): EdgeKind[];
  /**
   * What one file of a tree-sitter language asks for and publishes, as `Read` JSON.
   *
   * One file rather than a batch: the caller is a synchronous reader inside the
   * parse cache, holding one file's bytes, and the module path batches above it.
   * Nothing when the addon does not claim the language: every language on a
   * binary built without the grammars, which `native/build.mjs` falls back to.
   */
  readLanguage(language: string, file: string, source: string): string | null;
  /** A `Package.swift`'s targets as JSON `[{ name, path }]`; `null` unparsed or without grammars. */
  swiftTargets(source: string): string | null;
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
