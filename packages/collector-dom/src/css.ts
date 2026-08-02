import {
  SHORTHAND_PROPERTIES,
  type Declaration,
  type Diagnostic,
  type MatchedRule,
} from '@variance-authority/core';
import { evaluateMedia, evaluateSupports, type ConditionEnvironment } from './media.js';
import { mostSpecific, splitSelectorList, specificityOf, type Specificity } from './specificity.js';
import { classNamesOf, items, propertyNames } from './dom-list.js';

/**
 * CSS applicability pruning — ADR-0003 steps 1–3.
 *
 * This is the step that cannot live in `core`, because deciding whether a rule
 * applies requires asking a live DOM. It is also the step the headline claim
 * rests on: a Storybook canvas carries Storybook's own chrome CSS, the preview
 * reset, the entire design system, and a CSS-in-JS `<style>` tag that has been
 * accreting a rule for every story rendered since page load. Digesting that
 * means an unrelated component's CSS edit invalidates every baseline in the
 * repository.
 *
 * Everything matching nothing inside the subject is dropped here, before `core`
 * ever sees it.
 */

export interface IndexedRule {
  readonly sheet: string;
  readonly selector: string;
  readonly branch: string;
  readonly specificity: Specificity;
  readonly order: number;
  readonly declarations: readonly Declaration[];
  /** Rightmost simple selector, used to avoid testing every rule on every node. */
  readonly key: string;
  /** Some condition around this rule could not be evaluated with certainty. */
  readonly uncertain: boolean;
}

export interface StyleIndex {
  readonly byKey: ReadonlyMap<string, readonly IndexedRule[]>;
  readonly universal: readonly IndexedRule[];
  readonly diagnostics: readonly Diagnostic[];
  /** Rules seen before applicability filtering. Reported to show what was pruned. */
  readonly totalRules: number;

  /**
   * Which condition environment this index was flattened against, per
   * `conditionKey`.
   *
   * Carried so that an index handed back for reuse can be checked rather than
   * trusted. Conditions are *erased* during indexing — a rule inside a
   * non-matching `@media` never enters it — so an index is only meaningful for
   * the environment that erased them. Reusing one built at 480px to answer for
   * 1280px yields a capture whose declarations are the narrow layout's and whose
   * environment key says wide, which is a wrong answer that looks exactly like a
   * right one. Recording the key costs one string per index and makes that
   * mistake refusable.
   */
  readonly conditions: string;

  /**
   * Outcomes of conditions that depend on an input the *semantic* key omits.
   *
   * Narrow on purpose. ADR-0003 flattens conditions out of the rule text and puts
   * them in the environment key, but the semantic key already carries viewport
   * width, height, and colour scheme — so the outcome of `@media (min-width: …)`
   * is *derivable* from the key and recording it would be redundant. Worse than
   * redundant: it made a rule that matches nothing invalidate every baseline,
   * because adding a never-true media block changed the key. The corpus caught
   * that immediately.
   *
   * The one input the semantic key drops is `deviceScaleFactor`, so resolution
   * queries are the only conditions whose outcome is not otherwise recoverable.
   * Those are recorded, and nothing else is.
   *
   * Slightly over-conservative: a resolution query gating rules that match no
   * subject still splits the key. That costs two baselines where one would do,
   * which is the safe direction, and resolution queries are rare enough that the
   * precise version — testing whether the gated rules would match — is not worth
   * its complexity yet.
   */
  readonly evaluatedConditions: Readonly<Record<string, boolean>>;
}

/**
 * An index's condition environment, as a comparable string.
 *
 * Exists so reuse can be validated. Equality of two `ConditionEnvironment`
 * objects is not a question JavaScript answers — a fresh one is built per
 * collection — so the comparable form is derived instead.
 *
 * `supports` is recorded as present-or-absent rather than by identity, and that
 * is the honest limit of this check. Presence is what changes the *shape* of the
 * answer: without a probe every `@supports` block is included and marked
 * uncertain, with one the block is evaluated, and those are different rule sets.
 * Two probes from two different engines are not told apart here — the engine is
 * already part of the capture's environment key, and an index cannot outlive the
 * document it was built from, which has one view.
 */
export function conditionKey(environment: ConditionEnvironment): string {
  const features = Object.entries(environment.features ?? {})
    .map(([name, value]) => `${name}=${value}`)
    .sort();

  return [
    `width=${environment.width}`,
    `height=${environment.height}`,
    `scale=${environment.deviceScaleFactor}`,
    `scheme=${environment.colorScheme}`,
    `features=${features.join(',')}`,
    `supports=${environment.supports ? 'probed' : 'assumed'}`,
  ].join(' ');
}

/**
 * Flatten every reachable stylesheet into a matchable index.
 *
 * Conditional groups are evaluated against the declared environment and *erased*
 * — a rule inside a non-matching `@media` is inapplicable and never enters the
 * index. The condition itself belongs to the environment key, not to the rule
 * text: conditions are render inputs, not content.
 *
 * The result is a value, not a cache: it depends only on the document's sheets
 * and the environment, so a caller whose sheets have not changed may hand the
 * same one back to `collect` or `acquireDocument` instead of paying for it per
 * subject. Deciding *whether* the sheets changed is the caller's, because only
 * the caller watches them.
 */
export function indexStyleSheets(
  document: Document,
  environment: ConditionEnvironment,
): StyleIndex {
  const byKey = new Map<string, IndexedRule[]>();
  const universal: IndexedRule[] = [];
  const diagnostics: Diagnostic[] = [];
  const evaluatedConditions: Record<string, boolean> = {};
  let order = 0;
  let totalRules = 0;

  const sheets: CSSStyleSheet[] = items(document.styleSheets).filter(isStyleSheet);
  for (const adopted of adoptedSheets(document)) sheets.push(adopted);

  for (const [index, sheet] of sheets.entries()) {
    const name = sheetName(sheet, index);

    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      // A cross-origin sheet throws on access. Its rules are genuinely
      // unreadable, so the snapshot is incomplete and must say so rather than
      // report a confident hash over a partial view.
      diagnostics.push({
        severity: 'warn',
        code: 'unreadable-stylesheet',
        message: `stylesheet "${name}" is cross-origin; its rules were not collected`,
      });
      continue;
    }

    walk(rules, name, false);
  }

  return {
    byKey,
    universal,
    diagnostics,
    totalRules,
    evaluatedConditions,
    conditions: conditionKey(environment),
  };

  function walk(rules: CSSRuleList, sheet: string, uncertain: boolean): void {
    for (const rule of items(rules)) {
      if (isGroupingRule(rule)) {
        const condition = conditionOf(rule, environment);
        const prelude = preludeOf(rule);
        if (prelude !== null && dependsOnOmittedInput(prelude)) {
          evaluatedConditions[prelude] = condition.matches;
        }

        if (!condition.matches) continue;
        walk(rule.cssRules, sheet, uncertain || condition.uncertain);
        continue;
      }

      if (!isStyleRule(rule)) continue;

      totalRules += 1;
      const declarations = declarationsOf(rule.style);
      if (declarations.length === 0) continue;

      for (const branch of splitSelectorList(rule.selectorText)) {
        const indexed: IndexedRule = {
          sheet,
          selector: rule.selectorText,
          branch,
          specificity: specificityOf(branch),
          order: (order += 1),
          declarations,
          key: rightmostKey(branch),
          uncertain,
        };

        if (indexed.key === '*') universal.push(indexed);
        else {
          const bucket = byKey.get(indexed.key);
          if (bucket) bucket.push(indexed);
          else byKey.set(indexed.key, [indexed]);
        }
      }
    }
  }
}

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

/** Everything before the final combinator, or `null` when the selector is simple. */
function ancestorPortion(selector: string): string | null {
  let depth = 0;
  let lastBreak = -1;

  for (let index = 0; index < selector.length; index += 1) {
    const char = selector[index]!;
    if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    else if (depth === 0 && (char === ' ' || char === '>' || char === '+' || char === '~')) {
      lastBreak = index;
    }
  }

  return lastBreak < 0 ? null : selector.slice(0, lastBreak);
}

/**
 * The rightmost simple selector, as a bucket key.
 *
 * Correctness requirement: a selector whose rightmost compound cannot be reduced
 * to an id, class, or tag must land in the universal bucket, where it is tested
 * against everything. Putting it in a specific bucket would silently drop rules
 * — the failure mode that reads as `unchanged`.
 */
function rightmostKey(selector: string): string {
  const compound = lastCompound(selector);

  const id = /#([\w-]+)/.exec(compound);
  if (id) return `#${id[1]}`;

  const className = /\.((?:\\.|[\w-])+)/.exec(compound);
  if (className) return `.${className[1]!.replace(/\\/g, '')}`;

  const tag = /^([a-z][\w-]*)/i.exec(compound);
  if (tag && !compound.startsWith(':')) return tag[1]!.toLowerCase();

  if (compound.startsWith('[')) return '[attr]';

  return '*';
}

/** Split off the last compound selector, respecting combinators and nesting. */
function lastCompound(selector: string): string {
  let depth = 0;
  let start = 0;

  for (let i = 0; i < selector.length; i += 1) {
    const char = selector[i]!;
    if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    else if (depth === 0 && (char === ' ' || char === '>' || char === '+' || char === '~')) {
      start = i + 1;
    }
  }

  return selector.slice(start).trim();
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

function declarationsOf(style: CSSStyleDeclaration): Declaration[] {
  const declarations: Declaration[] = [];
  let pending = false;

  for (const property of propertyNames(style)) {
    const value = style.getPropertyValue(property);

    // An empty value here is not "no declaration". Chromium enumerates a
    // `var()`-tainted shorthand as its *longhand* names with empty values —
    // pending substitution — so `padding: var(--x) var(--y)` appears as four
    // empty `padding-*` entries and skipping them dropped the declaration
    // entirely. JSDOM's CSSOM keeps the authored shorthand instead, so the same
    // stylesheet produced different captures under the two profiles and a
    // shorthand/longhand rewrite read as a change under `chromium` only.
    // Found by P4; invisible to either profile scored alone.
    if (value === '') {
      pending = true;
      continue;
    }

    declarations.push(declaration(property, value, style));
  }

  if (!pending) return declarations;

  // Recover the shorthand the pending longhands came from. Restricted to
  // `var()`-bearing values because that is the only thing that leaves a longhand
  // pending: a shorthand with a resolvable value enumerates as longhands *with*
  // values, and re-emitting it here would declare the same properties twice.
  //
  // The shorthand is emitted unexpanded, as ADR-0003 requires — decomposition is
  // versioned by `core`'s ruleset, not by whichever engine the collector ran in.
  for (const shorthand of SHORTHAND_PROPERTIES) {
    const value = style.getPropertyValue(shorthand);
    if (value === '' || !value.includes('var(')) continue;
    declarations.push(declaration(shorthand, value, style));
  }

  return declarations;
}

function declaration(property: string, value: string, style: CSSStyleDeclaration): Declaration {
  const references = [...value.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1]!);

  return {
    property,
    value,
    important: style.getPropertyPriority(property) === 'important',
    ...(references.length > 0 ? { references } : {}),
  };
}

function conditionOf(
  rule: CSSGroupingRule,
  environment: ConditionEnvironment,
): { matches: boolean; uncertain: boolean } {
  const type = rule.constructor.name;

  if (type === 'CSSMediaRule' || 'media' in rule) {
    const media = (rule as CSSMediaRule).media;
    return evaluateMedia(media?.mediaText ?? '', environment);
  }

  if (type === 'CSSSupportsRule' || 'conditionText' in rule) {
    return evaluateSupports((rule as CSSSupportsRule).conditionText ?? '', environment);
  }

  // `@container`, `@layer`, `@scope`, and anything newer. Container queries in
  // particular depend on layout, which the declared-only profile does not have,
  // so the contents are included and marked uncertain rather than guessed at.
  return { matches: true, uncertain: true };
}

/**
 * Whether a condition's outcome depends on something the semantic key omits.
 *
 * Only `deviceScaleFactor` is omitted, so only resolution queries qualify. Every
 * other condition resolves from inputs the key already carries, which makes its
 * outcome derivable rather than something to record.
 */
function dependsOnOmittedInput(prelude: string): boolean {
  return /\b(min-|max-)?resolution\b|-webkit-device-pixel-ratio/i.test(prelude);
}

/** The condition text of a grouping rule, for the environment record. */
function preludeOf(rule: CSSGroupingRule): string | null {
  const media = (rule as CSSMediaRule).media?.mediaText;
  if (media) return `@media ${media}`;

  const supports = (rule as CSSSupportsRule).conditionText;
  if (supports) return `@supports ${supports}`;

  return null;
}

function isStyleSheet(sheet: StyleSheet): sheet is CSSStyleSheet {
  return 'cssRules' in sheet;
}

function isStyleRule(rule: CSSRule): rule is CSSStyleRule {
  return 'selectorText' in rule && 'style' in rule;
}

function isGroupingRule(rule: CSSRule): rule is CSSGroupingRule {
  return 'cssRules' in rule && !('selectorText' in rule);
}

function adoptedSheets(document: Document): CSSStyleSheet[] {
  const adopted = (document as Document & { adoptedStyleSheets?: CSSStyleSheet[] })
    .adoptedStyleSheets;
  return adopted ? [...adopted] : [];
}

/**
 * A stable name for a sheet.
 *
 * `href` where there is one. Otherwise the index, which is positional and
 * therefore unstable — but sheet names reach only the attribution side-channel,
 * which is outside the hash by design, so an unstable name costs a slightly
 * worse docket label and never a false invalidation.
 */
function sheetName(sheet: CSSStyleSheet, index: number): string {
  if (sheet.href) return sheet.href;

  const owner = sheet.ownerNode as Element | null;
  const id = owner?.getAttribute?.('id');
  if (id) return `<style#${id}>`;

  return `<style:${index}>`;
}
