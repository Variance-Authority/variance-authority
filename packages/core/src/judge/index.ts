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
 *
 * `ignore` is the group's second refusal to conflate two things. A difference the
 * operator declined to look at is not a difference that did not happen, so an
 * absorbed delta is counted, attributed to the rule that absorbed it, and the
 * rule is reported when it absorbs nothing — the same treatment `UNOBSERVED`
 * gives a band nobody could see.
 */

export type { Verdict, BandOutcome } from './verdict.js';
export { UNOBSERVED, severityOf, worstVerdict, blocks } from './verdict.js';

export { adjudicate, summarizeAdjudication } from './intent.js';
export type { Intent, IntentClaim, Policy, Adjudication, Adjudicated } from './intent.js';

export { buildDocket, summarize } from './docket.js';
export type { Docket, DocketEntry, DocketOptions } from './docket.js';

export { inspect, summarizeFindings } from './inspect.js';
export type { Finding, FindingRule, InspectionReportOptions } from './inspect.js';

export { applyIgnores, summarizeIgnores, validateIgnoreRule } from './ignore.js';
export { isUnder, matchesGlob, appliesToSubject, isExpired } from './scope.js';
export type { Scoped } from './scope.js';
export { fingerprintOfRoot, fingerprintOfMask, shapeOfDelta } from './fingerprint.js';
export type { MaskFingerprintOptions } from './fingerprint.js';
export type {
  IgnoreRule,
  IgnoreOptions,
  IgnoreOutcome,
  IgnoreRegister,
  AbsorbedByRule,
} from './ignore.js';

export { applySensitivity, asIgnore, bandsOf, summarizeSensitivity } from './sensitivity.js';
export type {
  Level,
  SensitivityRule,
  SensitivityOutcome,
  SensitivityRegister,
  Relaxation,
} from './sensitivity.js';

export { startTrail, record, progress, summarizeTrail } from './trail.js';
export type { Trail, TrailStep, Progress } from './trail.js';

export { compareLocales } from './locale.js';
export type { LocaleComparison, LocaleOptions, Uncompared } from './locale.js';
