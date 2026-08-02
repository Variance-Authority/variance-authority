/**
 * `@variance-authority/core/judge` — from what moved to whether anyone should mind.
 *
 * Verdicts and their ordering, intent claims and their adjudication, and the
 * docket a reader is handed. This is where policy lives, and it is deliberately
 * the last group and the smallest: everything above it produces facts, and a
 * team that disagrees with the policy replaces this and keeps the rest.
 *
 * `UNOBSERVED` is the group's whole argument in one export. A band a profile
 * cannot see is not a band that passed, and the type system will not let the two
 * be spelled the same way.
 *
 * `inspect` is the one member that needs no baseline. Everything else here
 * decides between two snapshots; it decides about one, which is the only way a
 * defect present on the *first* run is ever reported rather than approved into
 * the baseline.
 */

export type { Verdict, BandOutcome } from './verdict.js';
export { UNOBSERVED, severityOf, worstVerdict, blocks } from './verdict.js';

export { adjudicate, summarizeAdjudication } from './intent.js';
export type { Intent, IntentClaim, Policy, Adjudication, Adjudicated } from './intent.js';

export { buildDocket, summarize } from './docket.js';
export type { Docket, DocketEntry, DocketOptions } from './docket.js';

export { inspect, summarizeFindings } from './inspect.js';
export type { Finding, FindingRule, InspectionReportOptions } from './inspect.js';
