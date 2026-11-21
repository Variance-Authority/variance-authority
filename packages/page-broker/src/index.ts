/**
 * A broker for each complex part of an app — a checkout form, a combobox, a
 * dialog — that a test reaches through it: how a person finds it, what can be
 * done in it, and where each action can lead. Performing an action says where
 * the app went. A surface — `/dom` for a document, `/playwright` for a browser
 * page — answers the questions; the brokers are the same over both.
 *
 * It reads no signal from the app. Of Variance Authority it imports only
 * `@variance-authority/core`, for which requests count as work.
 */

export { broker, leads, stay, Unreached } from './broker.js';
export type { Act, Bound, Broker, Declared, Leads, Members, Outcomes, Reached, Reaching, Reason } from './broker.js';
export type { Elsewhere, Left, Query, Quiet, Surface, Target } from './surface.js';
