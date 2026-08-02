/**
 * `@variance-authority/dom` — extract a `RawCapture` from a live DOM.
 *
 * One implementation for both observation profiles. It performs CSS
 * applicability pruning, which cannot live in `core` because deciding whether a
 * rule applies requires a live DOM — and does no other cleanup, because every
 * other normalization rule must be versioned by the ruleset rather than by the
 * collector (ADR-0001, ADR-0003).
 */

export { collect, conditionsFor } from './collect.js';
export type { CollectOptions } from './collect.js';

export { conditionKey, indexStyleSheets, matchRulesFor } from './css.js';
export type { StyleIndex, IndexedRule } from './css.js';

export { evaluateMedia, evaluateSupports } from './media.js';
export type { ConditionEnvironment, ConditionResult } from './media.js';

export { specificityOf, mostSpecific, compareSpecificity, splitSelectorList } from './specificity.js';
export type { Specificity } from './specificity.js';

export { ariaOf, roleOf, accessibleName, stateOf } from './aria.js';

export { acquireDocument, serializeAttributes, PATH_ATTRIBUTE } from './document.js';
export type { AcquireOptions } from './document.js';
