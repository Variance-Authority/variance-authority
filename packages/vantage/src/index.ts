/**
 * `@variance-authority/vantage` — what a run is saying, while it is still saying
 * it.
 *
 * A suite already knows a great deal that nothing outside it can see. Which
 * realms answered and in what order; which work began and never finished; that a
 * service is plainly talking while the test hearing it hears nothing. All of it
 * exists for the length of one execution, is spent settling waits, and is then
 * discarded — which is right for a wait and wrong for anybody trying to
 * understand a suite from outside it.
 *
 * This is the second reader. A watching process listens, a run reports, and the
 * signals are held in memory that outlives the test instead of memory that ends
 * with it. Nothing is written to disk and nothing is added to the run's own
 * evidence: a report file records what a run *decided*, and this records what it
 * *is doing*, which stops being a fact the moment the process holding it exits.
 *
 * Two ends, two entrypoints, and the split is the same one
 * `@variance-authority/event` makes:
 *
 * - this entrypoint — {@link openVantage}, which a test suite imports and which
 *   costs one environment read when nothing is watching.
 * - `vantage/attach` — {@link attachVantage}, which the watcher imports, and
 *   which is the only half that opens a socket.
 *
 * Not limited to visual regression, and nothing here knows what a subject is. A
 * suite that never takes a screenshot reports exactly the same four sentences.
 */

// compass: variance-authority.runtime

export { createObservatory } from './observatory.js';
export type { Observatory, ObservatoryOptions } from './observatory.js';
export { VANTAGE_VERSION, isVantageReport } from './report.js';
export type {
  TestClosed,
  TestHeard,
  TestOpened,
  TestRemarked,
  VantageReport,
} from './report.js';
export type { RecordedEvent, TestState, VantageState, WatchedTest } from './state.js';
export { VANTAGE_VARIABLE, openVantage } from './watch.js';
export type { Vantage, WatchedTestIdentity } from './watch.js';
