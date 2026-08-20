/**
 * `@variance-authority/report` — what a run leaves behind.
 *
 * The **record** tool kind, in a box of its own. A run produces values in memory
 * and then the process ends; this is the shape the answers take so they can be
 * read afterwards, from a different process, on a different machine, by whoever
 * or whatever is asking.
 *
 * It lives here rather than with any of its readers because it has several, and
 * a format owned by one of them bends towards that one. The CLI writes it, the
 * MCP tools read it, a PR comment renders it, and none of those is the format's
 * home. That was not a hypothetical: the shapes used to live in the MCP package,
 * so the CLI depended on an agent protocol to describe its own output.
 *
 * It also holds the two derivations that belong to the format rather than to any
 * reader. The first groups a run's changes into the *distinct things that
 * happened*, so a token edit across forty stories is one decision rather than
 * forty. The second reads those changes back against what the author said they
 * were doing, which is the only way an artifact can report the edit that never
 * landed. The CLI prints both, the MCP tools answer from both, and neither owns
 * them.
 *
 * The default entrypoint is the format and needs nothing.
 * `@variance-authority/report/file` reads and writes it on a disk.
 */

export type {
  RunReport,
  ObservationRecord,
  RegionRecord,
  FindingRecord,
  NotObserved,
  NotObservedKind,
  FlakinessRecord,
  ChurnRecord,
  DriftRecord,
} from './format.js';

export type {
  CompositionReport,
  ComponentRecord,
  EchoRecord,
  DivergenceRecord,
  MovementRecord,
} from './composition.js';

export { clusterChanges, describeClustering } from './cluster.js';
export type { Change, Clustering } from './cluster.js';

export { adjudicateRun, describeAdjudication, parseRoot } from './intent.js';
export type {
  AdjudicateOptions,
  Claim,
  ClaimOutcome,
  ClaimRootKind,
  ClaimVerdict,
  RunAdjudication,
  UnclaimedChange,
} from './intent.js';
