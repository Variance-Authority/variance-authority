/**
 * `@variance-authority/dom` — extract a `RawCapture` from a live DOM.
 *
 * One implementation for both observation profiles. It performs CSS
 * applicability pruning, which cannot live in `core` because deciding whether a
 * rule applies requires a live DOM — and does no other cleanup, because every
 * other normalization rule must be versioned by the ruleset rather than by the
 * collector (ADR-0001, ADR-0003).
 *
 * **Requires a live DOM**, which is the whole reason it is not part of `core` and
 * the reason nothing else is part of it. Both profiles supply one — jsdom in a
 * unit test, Chromium in a page — and neither is named here.
 */

export { collect, conditionsFor } from './collect.js';
export type { CollectOptions } from './collect.js';

export { resolveIgnores, IGNORE_ATTRIBUTE, MARKED_RULE } from './ignore.js';
export type { IgnoreSelector, ResolveIgnoresOptions, ResolvedIgnores } from './ignore.js';

export { conditionKey, indexStyleSheets, matchRulesFor } from './css.js';
export type { StyleIndex, IndexedRule } from './css.js';

export { evaluateMedia, evaluateSupports } from './media.js';
export type { ConditionEnvironment, ConditionResult } from './media.js';

export { specificityOf, mostSpecific, compareSpecificity, splitSelectorList } from './specificity.js';
export type { Specificity } from './specificity.js';

export { ariaOf, roleOf, accessibleName, accessibleDescription, stateOf } from './aria.js';

export { attributeProvenance, statesProps } from './attributed.js';
export type { AttributeProvenanceOptions } from './attributed.js';

export { acquireDocument, serializeAttributes, PATH_ATTRIBUTE } from './document.js';
export type { AcquireOptions } from './document.js';
