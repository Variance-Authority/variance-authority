/**
 * `@variance-authority/core/rules` — the versioned opinions.
 *
 * What survives to be compared, and what a surviving value is turned into: the
 * property allowlist, the applicability ruleset, variable resolution, shorthand
 * expansion, colour and dimension canonicalization.
 *
 * Separate from the format because this is the part with a **version on it**.
 * `RULESET_VERSION` and `ALLOWLIST_VERSION` are folded into the identity of every
 * answer downstream, so changing a rule here makes stored results incomparable
 * rather than silently comparable — and a reader who wants to know *why* two runs
 * disagree ends up in this directory rather than anywhere else.
 */

export { normalize } from './normalize/index.js';
export type { NormalizeOptions } from './normalize/index.js';
export type {
  AliasMap,
  AliasResult,
  InheritContext,
  ResolvedStyle,
  DeclarationOrigin,
} from './normalize/index.js';
export {
  buildAliasMap,
  aliasAttributeValue,
  aliasStyleValue,
  resolveStyle,
  resolveVariables,
  INHERITED_PROPERTIES,
  EMPTY_CONTEXT,
  canonicalizeValue,
  canonicalizeTokens,
  canonicalizeDimension,
  canonicalizeColor,
  parseColor,
  formatColor,
  expandDeclaration,
  SHORTHAND_PROPERTIES,
} from './normalize/index.js';

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
