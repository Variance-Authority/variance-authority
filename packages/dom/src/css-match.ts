import type { MatchedRule } from '@variance-authority/core';
import { classNamesOf } from './dom-list.js';
import { ancestorPortion, lastCompound } from './selector-parts.js';
import type { IndexedRule, StyleIndex } from './css-index.js';

/**
 * The per-element half of the pruning: which indexed rules apply to one node.
 *
 * Separated from the index because this side runs once per node where indexing
 * runs once per document. Everything here is written against a finished
 * `StyleIndex` and a single element — it never reads a stylesheet, and cannot,
 * which is what keeps a design system's cost a one-time cost instead of a
 * per-node one.
 *
 * Latent coupling detection lives here for the same reason: a rule that matches
 * nothing contributes no declaration to the index and is only interesting once
 * there is an element to ask it about.
 */

/**
 * Rules matching one element, in document order.
 *
 * Only candidates whose rightmost simple selector could possibly match are
 * tested. Without that filter this is rules × elements, and a design system's
 * stylesheet against a page-sized subject makes the collector the slowest part
 * of the pipeline — in a system whose entire argument is that it does less work
 * than taking a screenshot.
 */
export interface MatchResult {
  readonly matched: MatchedRule[];
  /**
   * Root-state keys this element is *latently* coupled to.
   *
   * A rule like `html.dark .card` does not match today, so it contributes no
   * declaration and would be invisible to a matched-rules-only view. But the
   * moment something puts `dark` on `<html>` it applies — and if that something
   * is another subject in a shared session, this subject's baseline silently
   * became order-dependent.
   *
   * Latent coupling is detected by testing the rule's *rightmost* compound alone:
   * if the subject's own node would satisfy it and only the ancestor portion
   * fails, the rule is one root-state change away from applying. That is exactly
   * the coupling a no-rinse session needs to know about before it bites, rather
   * than after a hash mysteriously moves.
   */
  readonly couplings: readonly string[];
}

export function matchRulesFor(element: Element, index: StyleIndex): MatchResult {
  const candidates: IndexedRule[] = [...index.universal];

  const id = element.getAttribute('id');
  if (id) candidates.push(...(index.byKey.get(`#${id}`) ?? []));

  for (const className of classNamesOf(element)) {
    candidates.push(...(index.byKey.get(`.${className}`) ?? []));
  }

  candidates.push(...(index.byKey.get(element.tagName.toLowerCase()) ?? []));
  candidates.push(...(index.byKey.get('[attr]') ?? []));

  const matched: MatchedRule[] = [];
  const couplings = new Set<string>();

  for (const candidate of candidates) {
    if (safeMatches(element, candidate.branch)) {
      matched.push({
        sheet: candidate.sheet,
        selector: candidate.branch,
        specificity: candidate.specificity,
        order: candidate.order,
        declarations: candidate.declarations,
      });
      continue;
    }

    for (const key of latentCouplings(element, candidate.branch)) couplings.add(key);
  }

  return { matched: matched.sort((a, b) => a.order - b.order), couplings: [...couplings] };
}

/**
 * Root-state keys a non-matching rule would depend on, if its own compound fits.
 *
 * Only rules anchored on `html`/`:root`/`body` with a class or attribute
 * qualifier count. A rule failing because it needs a different *parent component*
 * is ordinary CSS, not shared-state coupling, and reporting it would bury the
 * theme leaks that matter under every descendant selector in the stylesheet.
 */
function latentCouplings(element: Element, selector: string): string[] {
  const ancestor = ancestorPortion(selector);
  if (ancestor === null) return [];

  const own = lastCompound(selector);
  if (own.length === 0 || !safeMatches(element, own)) return [];

  const keys: string[] = [];
  const lower = ancestor.toLowerCase();

  if (/(^|[\s>+~])(html|:root)\b/.test(lower) && /[.[]/.test(lower)) {
    keys.push('root-attr:class');
    for (const match of ancestor.matchAll(/\[([\w-]+)/g)) keys.push(`root-attr:${match[1]!}`);
  }
  if (/(^|[\s>+~])body\b/.test(lower) && /[.[]/.test(lower)) {
    keys.push('body-attr:class');
    for (const match of ancestor.matchAll(/\[([\w-]+)/g)) keys.push(`body-attr:${match[1]!}`);
  }

  return keys;
}

/**
 * `Element.matches` throws on a selector the engine cannot parse.
 *
 * Treated as *matching*, not as failing. An unparsed selector whose rule is
 * dropped removes a declaration from the hash; keeping it costs at most a value
 * that did not need to be there. Every ambiguity resolves toward over-reporting.
 */
function safeMatches(element: Element, selector: string): boolean {
  try {
    return element.matches(selector);
  } catch {
    return true;
  }
}
