/**
 * `@variance-authority/sense` — the file graph, read off a disk.
 *
 * [`core/relate`](https://github.com/Variance-Authority/variance-authority/tree/main/packages/core/src/relate) holds the structure and answers the
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
export { refreshDependencyLexiconNative, queryDependencyLexiconNative, dependencyStackNative, describedWordsNative, nearOfNative, phraseOfNative, wordStemsNative } from './dependency-lexicon.js';
export { ripgrepNative } from './ripgrep.js';

/**
 * Which languages this build reads, and every extension a scan will open.
 *
 * Published because *what was read* is a fact callers act on: a tool handed a
 * changed path has to know whether the graph was ever going to hold it, and the
 * alternative is a caller carrying its own extension list that drifts from this
 * one the first time a language is added.
 */
export { CODE_EXTENSIONS, LANGUAGES, READABLE, languageOf, grainOf, readsMembers, type LanguageId } from './language.js';

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
export type { SourceSymbol, SourceSymbolKind, SourceSymbolReach, TextSpan } from './harvest.js';

export {
  decidesResolution,
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
export { publishedNames, readPublishedNames, type PublishedNames } from './published-names.js';
export { placesOf, stepped, type Progress } from './progress.js';
export { readySourceIndex } from './ready-index.js';
export { inIndexTurn, indexTurnPath, type IndexTurnHolder } from './index-turn.js';
export type { SourceIndexState } from './source-index-file.js';

export { firstParentChanges, firstParentChangesBetween, trackedFiles, type CommitChange, type CommitChanges } from './commit-changes.js';
export { packageOwner } from './package-owner.js';
export { isTestPath } from './test-path.js';
export { fileSizes, matchesGlob, sourceScope, type FileSize, type SourceScope } from './source-scope.js';

export {
  packagesAround,
  dependenciesAround,
  orientAround,
  recordedCases,
  type OrientLimits,
  type PackagesAround,
  type RecordedCases,
} from './orient.js';
export {
  type NativeCasesEntered as CasesEntered,
  type NativeOrientation as Orientation,
  type NativeExternalOrientation as ExternalOrientation,
  type NativeOrientFlow as OrientFlow,
  type NativeOrientFlows as OrientFlows,
  type NativeOrientPackage as OrientPackage,
  type NativeOrientShare as OrientShare,
} from './native-orient.js';
export { recordedCaseNames, type RecordedCaseName, type RecordedCaseNames } from './recorded-case-names.js';
export {
  fileCases,
  recordedDurations,
  recordedPaths,
  recordedTimes,
  type RecordedCaseDurations,
  type RecordedDurations,
  type TimedTestCase,
  type TimedTestFile,
} from './recorded-durations.js';
export { recordedAttempts, type RecordedAttempts, type RetriedCase } from './recorded-attempts.js';
export { type DurationScope, type ScopeCounts } from './recorded-scope.js';
export { type RecordOrigin } from './test-selection/record-location.js';
export { layerMoves, type LayerCause, type LayerHeld, type LayerMoves, type LayerPresence } from './layer-moves.js';
export { tierMoves, type TierCause, type TierMoves } from './tier-moves.js';
export { declaredTiers, parseTiers, tierLabel, tierOf, TiersError, type TierPlace, type Tiers } from './tiers.js';
export { parseTypescript, TypescriptError } from './typescript.js';
export { tsconfigUse, type TsconfigUse } from './typescript-use.js';
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
  type CodeMapRead,
  type PreparedCodeMap,
} from './code-map.js';
export {
  type NativeOrientPackageLayer as PackageLayer,
  type NativeOrientLayers as PackageLayers,
  type NativeOrientMapAnswer as CodeMapAnswer,
  type NativeOrientMapMade as CodeMapMade,
  type NativeOrientMapPage as CodeMapPage,
  type NativeOrientMapPrepared as CodeMapPrepared,
  type NativeOrientMapRow as CodeMapRow,
  type NativeOrientMapShare as CodeMapShare,
  type NativeDeclaredRoleCheck as DeclaredRoleCheck,
  type NativeDeclaredRoleFinding as DeclaredRoleFinding,
  type NativeOrientShipped as ShippedFiles,
} from './native-orient.js';
export { loadedUnprobed, modulePath } from './module-path.js';
export { checkoutListing, checkoutPath, existedAt, existingAt, type CheckoutListing, type CheckoutPath } from './checkout-path.js';
export {
  forksBetween,
  journeysAmong,
  journeysAround,
  journeyMap,
  journeyMaps,
  journeysPath,
  pathsThrough,
  prepareJourneys,
  testCompositions,
  type SuiteJourneyMap,
  type JourneysAround,
  type PreparedJourneys,
  type SuiteTestComposition,
} from './journeys.js';
export {
  type NativeForksBetween as ForksBetween,
  type NativeJourneyBlock as JourneyBlock,
  type NativeJourneyCase as JourneyCase,
  type NativeJourneyEnd as JourneyEnd,
  type NativeJourneyFork as JourneyFork,
  type NativeJourneyFunction as JourneyFunction,
  type NativeJourneyMap as JourneyMap,
  type NativeJourneyMapBranch as JourneyMapBranch,
  type NativeJourneyMapFunction as JourneyMapFunction,
  type NativeJourneyMapPlace as JourneyMapPlace,
  type NativeJourneyPath as JourneyPath,
  type NativeJourneyPiece as JourneyPiece,
  type NativeJourneySide as JourneySide,
  type NativePathsThrough as PathsThrough,
  type NativeJourneysAmong as JourneysAmong,
  type NativeJourneysAnswer as JourneysAnswer,
  type NativeJourneysAsk as JourneysAsk,
  type NativeJourneysBlock as JourneysBlock,
  type NativeJourneysCall as JourneysCall,
  type NativeJourneysFile as JourneysFile,
  type NativeJourneysFlow as JourneysFlow,
  type NativeJourneysFlows as JourneysFlows,
  type NativeJourneysPlace as JourneysPlace,
  type NativeJourneysPlaced as JourneysPlaced,
  type NativeJourneysPrepared as JourneysPrepared,
  type NativeJourneysRegion as JourneysRegion,
  type NativeTestComposition as TestComposition,
} from './native-journeys.js';

export { gitDigests } from './tree.js';
export { seedPaths } from './files.js';
export { workingTreeChanges, type WorkingTreeChanges } from './working-tree-changes.js';
export {
  aliasesOf,
  declarationExported,
  declaredDescribedOf,
  declaredLooseOf,
  declaredOf,
  declaredTermsOf,
  nameTermsOf,
  encodeSearch,
  exportedDigest,
  forwardsDigest,
  importersOf,
  memberDeclarationsOf,
  membersOn,
  outsideSourcesOf,
  readHelp,
  type Alias,
  type ContainerMember,
  type DeclaredName,
  type DeclaredNames,
  type DescribedFile,
  type EncodedSearch,
  type ExportedDeclaration,
  type HelpPublish,
  type HelpReading,
  type MemberDeclarations,
  type MemberSite,
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
export { runGraphOf, type RunGraphOptions } from './taint/graph.js';
export { shadowReach, type ShadowReach } from './taint/reach.js';
export { auditTaints, type TaintAuditOptions, type TaintDeviation, type TaintDeviationKind } from './taint/audit.js';
