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

/**
 * Which languages this build reads, and every extension a scan will open.
 *
 * Published because *what was read* is a fact callers act on: a tool handed a
 * changed path has to know whether the graph was ever going to hold it, and the
 * alternative is a caller carrying its own extension list that drifts from this
 * one the first time a language is added.
 */
export { LANGUAGES, READABLE, languageOf, grainOf, type LanguageId } from './language.js';

export {
  memoryParseCache,
  openParseCache,
  type Parsed,
  type ParseCache,
  type PersistentParseCache,
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
export type { SourceIndexState } from './source-index-file.js';

export { gitDigests } from './tree.js';

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
export { mockTaint, type MockTaintOptions } from './taint/mocks.js';
export { auditTaints, type TaintAuditOptions, type TaintDeviation, type TaintDeviationKind } from './taint/audit.js';
