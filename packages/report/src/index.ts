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
 * It also holds the three derivations that belong to the format rather than to any
 * reader. The first groups a run's changes into the *distinct things that
 * happened*, so a token edit across forty stories is one decision rather than
 * forty. The second reads those changes back against what the author said they
 * were doing, which is the only way an artifact can report the edit that never
 * landed. The third folds what a reviewer accepted into the record of *why a
 * baseline is what it is*, which outlives this file — into a commit message where
 * baselines are commits, into a row where they are rows. The CLI prints them, the
 * MCP tools answer from them, and none of those owns them.
 *
 * The default entrypoint is the format and needs nothing.
 * `@variance-authority/report/file` reads and writes it on a disk.
 */

export type {
  RunReport,
  ObservationRecord,
  RegionRecord,
  FindingRecord,
  PresentationEffectEvidence,
  PresentationEffectRecord,
  PresentationEffectTransition,
  PresentationInformationRecord,
  PresentationSignalRecord,
  NotObserved,
  NotObservedKind,
  FlakinessRecord,
  ChurnRecord,
  DriftRecord,
  VariationRecord,
} from './format.js';

export type {
  CompositionReport,
  ComponentRecord,
  EchoRecord,
  DivergenceRecord,
  PartingRecord,
  MovementRecord,
} from './composition.js';

export type {
  ReachReport,
  ReachedComponent,
  ReachHole,
  SubjectReach,
} from './reach.js';

export { clusterChanges, describeClustering } from './cluster.js';
export type { Change, Clustering } from './cluster.js';

export { changelogOf, isRecorded } from './changelog.js';
export type {
  ChangelogDrift,
  ChangelogEntry,
  ChangelogOptions,
  ChangelogRecord,
  ChangelogSelection,
  Unrecordable,
} from './changelog.js';

export {
  changelogBody,
  parseCommitMessage,
  renderCommitMessage,
} from './changelog-message.js';
export type { CommitMessageOptions } from './changelog-message.js';

export { promotionOf, selectByShape, whyNotWhole } from './promotion.js';
export type { Promotion } from './promotion.js';

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
