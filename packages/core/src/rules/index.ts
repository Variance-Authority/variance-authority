/**
 * `@variance-authority/core/rules` — the versioned opinions.
 *
 * What survives to be compared, and what a surviving value is turned into: the
 * property allowlist, the applicability ruleset, variable resolution, shorthand
 * expansion, colour and dimension canonicalization.
 *
 * Separate from the format because this is the part with a **version on it**.
 * `RULESET_VERSION` and `ALLOWLIST_VERSION` are folded into the identity of every
 * answer downstream, so changing a rule here is named as the cause of every
 * stored result it moves rather than passing silently — and a reader who wants to know *why* two runs
 * disagree ends up in this directory rather than anywhere else.
 */

export { normalize } from './normalize/index.js';
export type { NormalizeOptions } from './normalize/index.js';
export type { AliasMap, AliasResult } from './normalize/alias.js';
export type { InheritContext, ResolvedStyle, DeclarationOrigin } from './normalize/cascade.js';
export { buildAliasMap, aliasAttributeValue, aliasStyleValue } from './normalize/alias.js';
export {
  declaredValue,
  resolveStyle,
  resolveVariables,
  INHERITED_PROPERTIES,
  EMPTY_CONTEXT,
} from './normalize/cascade.js';
export { canonicalizeValue, canonicalizeTokens, canonicalizeDimension, matchingParen } from './normalize/value.js';
export { canonicalizeColor, parseColor, formatColor } from './normalize/color.js';
export { expandDeclaration, SHORTHAND_PROPERTIES } from './normalize/shorthand.js';

export {
  RULESET_VERSION,
  ALLOWLIST_VERSION,
  STYLE_ALLOWLIST,
  ATTRIBUTE_ALLOWLIST,
  ID_REFERENCE_ATTRIBUTES,
  ID_REFERENCE_LIST_ATTRIBUTES,
  isAllowedProperty,
  isCustomProperty,
  admits,
  admitsAttribute,
} from './ruleset.js';
