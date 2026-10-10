/**
 * `@variance-authority/sense` — the file graph, read off a disk.
 *
 * [`core/relate`](../../core/src/relate) holds the structure and answers the
 * questions; it performs no I/O and depends on nothing (ADR-0006). This is the
 * half that opens files: an `oxc` parse for the module record, a resolver for
 * turning a specifier into a path, and a walk that follows what it finds.
 *
 * It is separate because it is the expensive, replaceable half. A repository that
 * already computes this — `nx`, `turbo`, a bundler's own graph — can produce
 * `FileRecord`s from that instead, hand them to the same fold, and every question
 * downstream is answered identically.
 *
 * ## The one rule
 *
 * A file whose outgoing edges cannot all be enumerated says so: its record
 * names the reason, and a report on the scan names the file. An edge dropped in
 * silence does not produce a smaller answer, it produces a **wrong** one that
 * nobody can see. The graph does not stand in for the edge it could not read —
 * nothing is widened for it — because the recorded run sees the module load
 * whatever expression named it, and that is who answers for the edge.
 */

// compass: variance-authority.reach

export { scanRelations, type ScanOptions } from './scan.js';
export { refreshDependencyLexiconNative, queryDependencyLexiconNative, dependencyStackNative } from './dependency-lexicon.js';

/**
 * Which languages this build reads, and every extension a scan will open.
 *
 * Published because *what was read* is a fact callers act on: a tool handed a
 * changed path has to know whether the graph was ever going to hold it, and the
 * alternative is a caller carrying its own extension list that drifts from this
 * one the first time a language is added.
 */
export { LANGUAGES, READABLE, languageOf, grainOf, type LanguageId } from './language.js';

/**
 * One module's component index, read off its tree: where each component it
 * declares is declared, for attribution to name `file:line`.
 */
export { indexDeclarations } from './declarations.js';

export {
  memoryParseCache,
  openParseCache,
  type Parsed,
  type ParseCache,
  type PersistentParseCache,
  type SourceSize,
} from './cache.js';
export type { SourceSymbol, SourceSymbolKind, TextSpan } from './harvest.js';
export { enrichSources, type HarvestSubject } from './enrich.js';

export {
  treeShapeOf,
  memoryRecordCache,
  openRecordCache,
  type RecordCache,
  type PersistentRecordCache,
  type TreeShape,
} from './reuse.js';

export {
  openSourceIndex,
  readSourceRecords,
  sourceIndexPath,
  type PersistentSourceIndex,
} from './source-index.js';

export {
  publishedSources,
  readPublishedSources,
  sourcesWithin,
  updateSourceIndex,
  SourceIndexUnpublished,
  type PublishedSources,
  type PublishedSourcesOptions,
  type SourceUpdate,
  type SourceUpdateOptions,
} from './published.js';
export { readySourceIndex } from './ready-index.js';
export { inIndexTurn, indexTurnPath, type IndexTurnHolder } from './index-turn.js';
export type { SourceIndexState } from './source-index-file.js';

export { fileSizes, matchesGlob, sourceScope, type FileSize, type SourceScope } from './source-scope.js';

export {
  packagesAround,
  dependenciesAround,
  orientAround,
  recordedCases,
  type CasesEntered,
  type Orientation,
  type ExternalOrientation,
  type OrientFlow,
  type OrientFlows,
  type OrientLimits,
  type OrientPackage,
  type OrientShare,
  type PackagesAround,
  type RecordedCases,
} from './orient.js';
export {
  fileCases,
  recordedDurations,
  recordedPaths,
  recordedTimes,
  type DurationScope,
  type RecordedCaseDurations,
  type ScopeCounts,
  type RecordedDurations,
  type TimedTestCase,
  type TimedTestFile,
} from './recorded-durations.js';
export { layerMoves, type LayerCause, type LayerHeld, type LayerMoves, type LayerPresence } from './layer-moves.js';
export { tierMoves, type TierCause, type TierMoves } from './tier-moves.js';
export { declaredTiers, parseTiers, tierLabel, tierOf, TiersError, type TierPlace, type Tiers } from './tiers.js';
export {
  cappedLayers,
  cappedTiers,
  chainBetween,
  relationBetween,
  restrictedImports,
  type CapViolation,
  type Decision,
  type LayerCap,
  type RelationRule,
  type RuleFile,
  type TierCap,
  type TierCapFinding,
  type TierCapReport,
  type Violation,
} from './restrictions.js';
export { restrictedChains, type ChainViolation } from './restrictions-transitive.js';
export {
  codeMapPage,
  declaredRoles,
  packageLayers,
  prepareCodeMap,
  shippedFiles,
  type PackageLayer,
  type PackageLayers,
  type CodeMapAnswer,
  type CodeMapMade,
  type CodeMapPage,
  type CodeMapPrepared,
  type CodeMapRead,
  type CodeMapRow,
  type CodeMapShare,
  type DeclaredRoleCheck,
  type DeclaredRoleFinding,
  type PreparedCodeMap,
  type ShippedFiles,
} from './code-map.js';
export { checkoutListing, checkoutPath, type CheckoutListing, type CheckoutPath } from './checkout-path.js';
export {
  forksBetween,
  journeysAmong,
  journeysAround,
  journeyMap,
  journeyMaps,
  journeysPath,
  pathsThrough,
  prepareJourneys,
  type ForksBetween,
  type JourneyBlock,
  type JourneyCase,
  type JourneyEnd,
  type JourneyFork,
  type JourneyFunction,
  type JourneyMap,
  type JourneyMapBranch,
  type JourneyMapFunction,
  type JourneyMapPlace,
  type SuiteJourneyMap,
  type JourneyPath,
  type JourneySide,
  type PathsThrough,
  type JourneysAmong,
  type JourneysAnswer,
  type JourneysAround,
  type JourneysAsk,
  type JourneysBlock,
  type JourneysCall,
  type JourneysFile,
  type JourneysFlow,
  type JourneysFlows,
  type JourneysPlace,
  type JourneysPlaced,
  type JourneysPrepared,
  type JourneysRegion,
  type PreparedJourneys,
} from './journeys.js';

export { gitDigests } from './tree.js';
export { workingTreeChanges, type WorkingTreeChanges } from './working-tree-changes.js';
export {
  encodeSearch,
  exportedDigest,
  importersOf,
  readHelp,
  type EncodedSearch,
  type HelpPublish,
  type HelpReading,
  type PublishedRows,
  type SearchGeneration,
} from './help-reading.js';

export {
  taintFile,
  taintRecords,
  taintTable,
  type ImportDiff,
  type Tainted,
  type Taint,
  type TaintOptions,
  type TaintSubject,
  type TaintTable,
} from './taint/index.js';
export { moduleCallsTaint, type ModuleCallsTaintOptions } from './taint/calls.js';
export { mayMock, mockTaint, type MockTaintOptions } from './taint/mocks.js';
export { shadowReach, type ShadowReach } from './taint/reach.js';
export { auditTaints, type TaintAuditOptions, type TaintDeviation, type TaintDeviationKind } from './taint/audit.js';
