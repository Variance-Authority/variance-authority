/**
 * `@variance-authority/history` — the contract and the arithmetic.
 *
 * The question a single run cannot answer: a button gains 2px, eleven times, each
 * approved correctly, and nobody ever sees the 22px change. No threshold catches
 * it, because the quantity that would is a **sum** and a one-run-at-a-time tool
 * keeps none.
 *
 * It also holds **no client**. A store reached over a hop is
 * `@variance-authority/history/client`, one import away and not on the path of
 * anyone who only wants to know what a churn number means.
 *
 * This package holds **no storage**. That is a boundary, not an omission. Storage
 * is `@variance-authority/server`, run by the operator in their own
 * infrastructure, because a record kept as a file in the repository puts derived
 * state under human merge resolution and the hashes of a merge commit are neither
 * branch's (spec 0002, epitaphs). What is left here is everything that can be
 * argued about without a database: what a row is allowed to contain, what the
 * numbers mean, and what to say when there is no store at all.
 */

export type { Band, Observation, RunContext, RunRecord, TokenValue } from './observation.js';
export { BANDS, observationsFrom } from './observation.js';

export type { FrequencyBand, Instability } from './instability.js';

export type { Approval } from './approval.js';
export { approvalKey } from './approval.js';

export type {
  Answer,
  BandChurn,
  Churn,
  Flakiness,
  FlakyCause,
  HistoryStore,
  Journey,
  Reach,
  Unkept,
  Window,
} from './store.js';
export { isKept } from './store.js';

export type { FlakinessInput } from './flakiness.js';
export { accumulateFlakiness, describeFlakiness } from './flakiness.js';

export type { ChurnInput, DriftOptions, DriftStep, Quantity, TokenDrift } from './drift.js';
export {
  accumulateChurn,
  describeChurn,
  describeDrift,
  describeLastChanged,
  describeReach,
  detectDrift,
} from './drift.js';

export type {
  ApproveRequest,
  CurrentRequest,
  CurrentResponse,
  LastChangedResponse,
  RecordRequest,
} from './protocol.js';
export {
  APPROVALS_PATH,
  CHURN_PATH,
  CURRENT_PATH,
  FLAKINESS_PATH,
  HISTORY_API_VERSION,
  LAST_CHANGED_PATH,
  MAX_CURRENT_SUBJECTS,
  OBSERVATIONS_PATH,
  REACH_PATH,
  VALUE_JOURNEY_PATH,
} from './protocol.js';

export { createAbsentStore, unkept } from './absent.js';
