/**
 * `@variance-authority/cli` — the system as a command, and as a library.
 *
 * The package has a `bin`, but everything the `bin` does is exported here as
 * ordinary functions, and that is deliberate. A CLI whose logic is reachable only
 * by spawning a process can be tested only by spawning one, so the questions that
 * actually matter — *does this exit code mean what CI thinks it means*, *is this
 * skip reported* — become integration tests with a browser in them, which is to
 * say they stop being asked.
 *
 * The seams, in the order a reader meets them:
 *
 * - `config.ts` decides what a run is, from a file the operator wrote. Nothing is
 *   inferred from the network and nothing is downloaded, so the run's inputs are
 *   the ones in the repository.
 * - `exit.ts` decides the one integer CI reads, and keeps a verdict and a crash
 *   on different codes.
 * - `commands/run.ts` collects, settles what the cheap tiers can settle, renders
 *   only the residue, and writes a report that accounts for every subject —
 *   including the ones it did not observe, which is the failure this whole system
 *   exists to make impossible.
 * - `commands/report.ts` answers from that artifact and never re-runs.
 * - `commands/merge.ts` makes N shard artifacts into one, and refuses the pairs
 *   that were never one run — which is what lets a sharded suite have a single
 *   exit code and a single pull-request comment.
 * - `commands/comment.ts` renders that same artifact as a pull-request body —
 *   report in, string out, no network and no clock, which is what lets the CI
 *   action shell out to `variance comment` instead of carrying a second
 *   renderer that would drift from this one.
 * - `commands/accept.ts` promotes an image the run already produced, and never
 *   produces one.
 * - `commands/doctor.ts` reports what this machine can observe, having observed
 *   it, and states the limit of its own font probe.
 */

export {
  DEFAULT_REPORT_PATH,
  ConfigError,
  loadConfig,
  parseConfig,
} from './config.js';
export type {
  BaselinesConfig,
  Config,
  DirectoryBaselines,
  HistoryConfig,
  LfsBaselines,
  ListSubjects,
  ParseOptions,
  RemoteBaselines,
  StorybookSubjects,
  SubjectsConfig,
} from './config.js';

export { EXIT_CLEAN, EXIT_OPERATOR, EXIT_REVIEW, OperatorError, exitFor } from './exit.js';
export type { ExitCode, ReviewableReport } from './exit.js';

export {
  loadCollector,
  matchesGlob,
  planList,
  planStorybook,
  readCliRunReport,
  recordOf,
  run,
  settle,
  storeFor,
  writeArtifactToDisk,
  writeCliRunReport,
} from './commands/run.js';
export type {
  CliRunReport,
  Collected,
  Collector,
  CollectorContext,
  NotObserved,
  NotObservedKind,
  Plan,
  PlannedSubject,
  RunDeps,
  RunOptions,
  Settlement,
  SubjectSource,
} from './commands/run.js';

export { formatReport } from './commands/report.js';
export type { ReportFormat, ReportOptions } from './commands/report.js';

export { mergeReports } from './commands/merge.js';
export type { Shard } from './commands/merge.js';

export { accept, formatAcceptance, readCandidate } from './commands/accept.js';
export type {
  AcceptOptions,
  AcceptResult,
  Accepted,
  CandidateReader,
  Refused,
} from './commands/accept.js';

export { serve } from './commands/serve.js';
export type { ServeOptions } from './commands/serve.js';

export { COMMENT_MARKER, DEFAULT_LIMITS, renderComment } from './commands/comment.js';
export type { CommentLimits, CommentOptions } from './commands/comment.js';

export {
  doctor,
  exitForDiagnosis,
  fontProbeDocument,
  formatDiagnosis,
  machineProbes,
} from './commands/doctor.js';
export type {
  BaselineFinding,
  Diagnosis,
  DoctorProbes,
  FontFinding,
  HistoryFinding,
  RendererFinding,
} from './commands/doctor.js';

/**
 * The renderer the config asks for, from the package the config belongs to.
 *
 * Here rather than left to the caller so that composing a run needs one import
 * (ADR-0024): filling `deps.renderer` in with `createPlaywrightRenderer` means
 * knowing about the browser package, and means re-deciding `browser` and
 * `renderer` — two config fields — in every composition that does it.
 */
export { rendererFor, openRenderer } from './dispatch.js';
