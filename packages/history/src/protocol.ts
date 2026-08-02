import type { Observation, RunRecord, TokenValue } from './observation.js';

/**
 * The wire, as both ends agree on it.
 *
 * Paths and body shapes, and nothing that speaks. The client is
 * `@variance-authority/history/client`; the service is
 * `@variance-authority/server`. Neither is allowed to import the other, so if
 * this file did not exist one of them would have to — and a client and a server
 * disagreeing about a URL is the class of failure that presents as a 404 nobody
 * can explain.
 */

/** Bumped when the wire shape changes incompatibly, so a mismatch 404s loudly. */
export const HISTORY_API_VERSION = 'v1';

export const OBSERVATIONS_PATH = `/${HISTORY_API_VERSION}/observations`;
export const LAST_CHANGED_PATH = `/${HISTORY_API_VERSION}/last-changed`;
export const CHURN_PATH = `/${HISTORY_API_VERSION}/churn`;
export const VALUE_JOURNEY_PATH = `/${HISTORY_API_VERSION}/value-journey`;
export const REACH_PATH = `/${HISTORY_API_VERSION}/reach`;

/**
 * The body of a write.
 *
 * The run travels with the rows rather than in a second call, so a service can
 * commit both or neither. Recording rows whose run never landed would leave a
 * change with no denominator, and recording the run without its rows would leave
 * a quiet run that was not quiet.
 */
export interface RecordRequest {
  readonly run: RunRecord;
  readonly observations: readonly Observation[];
  readonly tokens: readonly TokenValue[];
}

/** `null` means the record contains no such change, which is an answer. */
export interface LastChangedResponse {
  readonly observation: Observation | null;
}
