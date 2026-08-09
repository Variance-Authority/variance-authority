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
export const CURRENT_PATH = `/${HISTORY_API_VERSION}/current`;
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

/**
 * The read a run makes before it writes, and the one read that is a `POST`.
 *
 * Not because it changes anything — it changes nothing — but because its
 * parameter is a subject list. Three hundred subject ids do not fit in a query
 * string that every proxy between a CI job and the service will forward, and the
 * failure mode of trying is a 414 from a load balancer nobody configured, halfway
 * through a rollout. A body has no such ceiling, so the argument travels as one.
 *
 * The cost of that choice is that a cache cannot see this as a read. There is
 * nothing to cache: the answer is the store's current state and the caller is
 * about to append to it.
 */
export interface CurrentRequest {
  readonly subjects: readonly string[];
}

export interface CurrentResponse {
  readonly observations: readonly Observation[];
}

/**
 * How many subjects one `current` request may name.
 *
 * A cap on the *question*, not on the answer, and that is the whole distinction
 * this constant carries. The answer is never trimmed — a trimmed answer becomes a
 * change that did not happen (see {@link CurrentRequest} and `HistoryStore.current`)
 * — so what has to be bounded instead is how much any one request asks for. The
 * client splits a longer subject list into several requests and concatenates the
 * results, which is arithmetic-free: the scopes are disjoint by subject.
 *
 * 200 rather than a round thousand because it is also the SQL binding count of
 * the only backend that exists, whose default parameter ceiling is 999. Both ends
 * agree on it here so that neither has to discover the other's limit at runtime.
 */
export const MAX_CURRENT_SUBJECTS = 200;
