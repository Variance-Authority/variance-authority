import type { ObservationProfile } from '@variance-authority/core/format';
import { EMPTY_CONTEXT, resolveStyle } from '@variance-authority/core/rules';
import type { StyleIndex } from './css.js';
import { matchRulesFor } from './css.js';
import { propertyNames } from './dom-list.js';

/**
 * What the ancestors contribute, and why a subject cannot be read without them.
 *
 * A subject is a subtree, and a subtree is not self-contained: `color` reaches in
 * from an ancestor that is not part of it, and `:root` declares the design tokens
 * every value inside it resolves through. Applicability pruning correctly drops
 * the rules that declare those, because they match nothing *inside* the subject —
 * so the values have to arrive some other way, and this file is that way.
 *
 * Split out of `collect.ts` because it is the only part of collection that looks
 * *outward* from the subject, and because it fails differently: everything else
 * there is wrong when it reads the subject wrongly, and this is wrong when it
 * reads nothing at all — which is exactly what it did, silently, until the token
 * band was found inert under JSDOM.
 */

/**
 * Inherited values in force at the subject root.
 *
 * Mandatory, not an optimization (ADR-0003). Applicability pruning drops every
 * rule matching nothing inside the subtree — including rules on ancestors
 * *outside* it whose inheritable properties still reach in. Without this seed
 * the cheap tier reports false `unchanged`.
 *
 * Under a profile without computed style there is no way to read the ancestors'
 * resolved values, so the seed is empty and the tier is correspondingly weaker.
 * That is reported by the profile, not papered over here.
 */
export function inheritedSeed(
  root: Element,
  profile: ObservationProfile,
  view: Window | null,
  index: StyleIndex,
): Record<string, string> {
  if (!root.parentElement) return {};

  if (profile.computedStyle && view) {
    const parent = view.getComputedStyle(root.parentElement);
    const seed: Record<string, string> = {};

    for (const property of INHERITABLE) {
      const value = parent.getPropertyValue(property);
      if (value) seed[property] = value;
    }
    for (const property of propertyNames(parent)) {
      if (property.startsWith('--')) seed[property] = parent.getPropertyValue(property);
    }

    return seed;
  }

  return declaredAncestorSeed(root, index);
}

/**
 * Resolve the ancestor cascade by hand, for profiles with no computed style.
 *
 * Returning `{}` here — which this did — quietly disabled the entire token
 * dimension under JSDOM. Design tokens are declared on `:root`, `:root` is
 * outside every subject's subtree, so applicability pruning correctly drops the
 * rule that defines them; with no seed to carry them in, `var(--brand)` resolved
 * to nothing and every token-driven value in the snapshot was empty. The corpus
 * missed it because its overrides are inline on the subject root; a real project
 * declares them on `:root` and would have found the token band inert.
 *
 * The fix walks `documentElement → …  → root.parentElement`, matching rules and
 * running `core`'s cascade at each step, threading the inherit context down. It
 * is the same resolver the subject itself uses, so the seed cannot drift from the
 * ruleset that consumes it — the ADR-0001 property, applied one level up.
 */
function declaredAncestorSeed(root: Element, index: StyleIndex): Record<string, string> {
  const chain: Element[] = [];
  for (let node = root.parentElement; node; node = node.parentElement) chain.unshift(node);

  let context = EMPTY_CONTEXT;
  for (const ancestor of chain) {
    const inline = (ancestor as HTMLElement).style;
    const inlineStyle: Record<string, string> = {};
    for (const property of propertyNames(inline)) {
      inlineStyle[property] = inline.getPropertyValue(property);
    }

    context = resolveStyle({
      matchedRules: matchRulesFor(ancestor, index).matched,
      ...(Object.keys(inlineStyle).length > 0 ? { inlineStyle } : {}),
      context,
    }).childContext;
  }

  return { ...context.inherited, ...context.customProperties };
}

const INHERITABLE: readonly string[] = [
  'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant',
  'font-stretch', 'line-height', 'letter-spacing', 'word-spacing',
  'text-align', 'text-indent', 'text-transform', 'white-space', 'word-break',
  'overflow-wrap', 'visibility', 'direction', 'writing-mode',
  'caption-side', 'border-collapse', 'border-spacing',
];
