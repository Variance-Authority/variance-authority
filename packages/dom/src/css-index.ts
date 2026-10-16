import type { Declaration, Diagnostic } from '@variance-authority/core/format';
import { declarationsOf } from './declarations.js';
import { evaluateMedia, evaluateSupports, type ConditionEnvironment } from './media.js';
import { splitSelectorList, specificityOf, type Specificity } from './specificity.js';
import { items } from './dom-list.js';
import { lastCompound, outsideArguments, splitPseudoElement, unescapeName } from './selector-parts.js';
import { STABILIZE_ATTRIBUTE } from './stabilize.js';
import { faceOf, isFontFaceRule, type IndexedFace } from './font-faces.js';
import { LayerOrder, layerBlockName, layerStatementNames, within, type LayerName } from './layers.js';

/**
 * The per-document half of the pruning: sheets flattened into a matchable index.
 *
 * Separated from the matcher next door by the rate each side runs at. An index
 * is built once per document per environment; matching runs once per element in
 * the subject. Everything that does not depend on *which element is asking*
 * belongs on this side — condition evaluation, declaration extraction, bucket
 * keys — and putting any of it on the other side multiplies a stylesheet-sized
 * cost by the node count, which is the rules × elements failure the rightmost-key
 * bucketing exists to avoid. Two files make that boundary visible; one file left
 * nothing to notice it being crossed.
 *
 * Nothing here reads an element. That is a property worth keeping: it is what
 * lets an index be a value a caller may hand back rather than a cache.
 */

export interface IndexedRule {
  readonly sheet: string;
  readonly selector: string;
  readonly branch: string;
  readonly specificity: Specificity;
  readonly order: number;
  readonly declarations: readonly Declaration[];
  /**
   * What the originating element must match: the branch without its trailing
   * pseudo-element, or the branch itself when it styles an element.
   */
  readonly host: string;
  /** The pseudo-element the rule styles, as `::before`; absent when it styles an element. */
  readonly pseudo?: string;
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
   * Every `@font-face` in force, in document order, under the same conditions
   * as the rules. A face matches no element, so it is kept here rather than in
   * a bucket, and `facesUsedBy` asks the subject which of them it is set in.
   */
  readonly faces: readonly IndexedFace[];

  /** Every cascade layer the sheets declare, in the order they declare them. */
  readonly layers: readonly LayerName[];

  /** The layer each layered rule sits in, by its `order`; an unlayered rule is absent. */
  readonly layerOf: ReadonlyMap<number, LayerName>;

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
    `device=${environment.device ? 'probed' : 'assumed'}`,
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
/**
 * The one sheet this project injects into somebody else's page.
 *
 * Skipped rather than collected, and that is what makes stabilization *outside
 * the subject* damage rather than content. Its rules are universal by
 * construction — `*, *::before, *::after` — so collecting them would attach a
 * matched rule to every node in every subject, churn every hash, and put a
 * declaration nobody wrote into the attribution of a component that did not
 * write it. What survives into the capture is the *effect* of the sheet, which
 * is the thing that was wanted; the sheet itself is the tool, and the tool is
 * not the subject.
 *
 * Matched on the owning element's attribute rather than on the rule text,
 * because rule text is something an application could legitimately contain.
 *
 * Asked of the owner optionally, twice over, because a sheet may have no owner
 * and an owner may be no element. The CSSOM says the first is `null`; a DOM
 * implementation is free to say `undefined` instead, and one does — jsdom below
 * 26 leaves `ownerNode` unset on every sheet it parses. A `!== null` guard reads
 * as defensive and admits exactly that value, so the next line dereferenced it
 * and the first page with a stylesheet on it threw a TypeError out of a private
 * module rather than returning a snapshot. Every other reader of `ownerNode` in
 * this project already asks with `?.`; this one is the outlier, and it is the
 * one that ran first.
 */
function isStabilizationSheet(sheet: CSSStyleSheet): boolean {
  const owner = sheet.ownerNode as Element | null | undefined;
  return owner?.hasAttribute?.(STABILIZE_ATTRIBUTE) === true;
}

/**
 * The sheets this project reads, in cascade order: every readable kind of sheet
 * the document holds, less the one it injected itself, then the adopted ones.
 */
export function authoredSheets(document: Document): CSSStyleSheet[] {
  const sheets: CSSStyleSheet[] = items(document.styleSheets)
    .filter(isStyleSheet)
    .filter((sheet) => !isStabilizationSheet(sheet));
  for (const adopted of adoptedSheets(document)) sheets.push(adopted);
  return sheets;
}

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

  const faces: IndexedFace[] = [];
  const layers = new LayerOrder();
  const layerOf = new Map<number, LayerName>();

  for (const [index, sheet] of authoredSheets(document).entries()) {
    const name = sheetName(sheet, index);

    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      // A cross-origin sheet throws on access. Its rules are genuinely
      // unreadable, so the snapshot is incomplete and must say so rather than
      // report a confident hash over a partial view.
      //
      // `error`, which is the severity `exitFor` gates on, because the two
      // severities separate a standing limit from a hole and this is a hole. A
      // limit fires on every subject of a correctly configured suite —
      // `unverified-fonts` does, and a gate red on every run is a gate that gets
      // switched off. This fires only when styling that belongs to the subject
      // is dropped, identically, from both sides of a comparison: the images
      // then agree, the verdict is honestly `unchanged`, and the part of the
      // cascade nobody read is the part nobody compared. No verdict can express
      // that, which is why the severity has to.
      diagnostics.push({
        severity: 'error',
        code: 'unreadable-stylesheet',
        message: `stylesheet "${name}" is cross-origin; its rules were not collected`,
      });
      continue;
    }

    walk(rules, name, sheet.href ?? document.baseURI, false, undefined);
  }

  return {
    byKey,
    universal,
    diagnostics,
    totalRules,
    faces,
    layers: layers.names,
    layerOf,
    evaluatedConditions,
    conditions: conditionKey(environment),
  };

  function walk(
    rules: CSSRuleList,
    sheet: string,
    base: string,
    uncertain: boolean,
    layer: LayerName | undefined,
  ): void {
    for (const rule of items(rules)) {
      const statement = layerStatementNames(rule);
      if (statement !== null) {
        for (const name of statement) layers.declare(within(layer, name));
        continue;
      }

      const block = layerBlockName(rule);
      if (block !== null) {
        const name = block === '' ? layers.anonymousWithin(layer) : within(layer, block);
        layers.declare(name);
        walk((rule as CSSGroupingRule).cssRules, sheet, base, uncertain, name);
        continue;
      }

      if (isGroupingRule(rule)) {
        const condition = conditionOf(rule, environment);
        const prelude = preludeOf(rule);
        if (prelude !== null && dependsOnOmittedInput(prelude)) {
          evaluatedConditions[prelude] = condition.matches;
        }

        if (!condition.matches) continue;
        walk(rule.cssRules, sheet, base, uncertain || condition.uncertain, layer);
        continue;
      }

      if (isFontFaceRule(rule)) {
        const face = faceOf(rule, base, document);
        if (face !== null) faces.push(face);
        continue;
      }

      if (!isStyleRule(rule)) continue;

      totalRules += 1;
      const declarations = declarationsOf(rule.style);
      if (declarations.length === 0) continue;

      for (const branch of splitSelectorList(rule.selectorText)) {
        const split = splitPseudoElement(branch);
        const host = split?.host ?? branch;
        const indexed: IndexedRule = {
          sheet,
          selector: rule.selectorText,
          branch,
          specificity: specificityOf(branch),
          order: (order += 1),
          declarations,
          host,
          ...(split ? { pseudo: split.pseudo } : {}),
          key: rightmostKey(host),
          uncertain,
        };
        if (layer !== undefined) layerOf.set(indexed.order, layer);

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

/** A CSS escape: up to six hex digits and one whitespace, or one character. */
const ESCAPE = String.raw`\\(?:[0-9a-fA-F]{1,6}[ \t\n]?|.)`;

/** The characters of an id or class: name characters, non-ASCII, or an escape. */
const NAME = String.raw`(?:${ESCAPE}|[\w-]|[^\x00-\x7f])+`;

/**
 * The rightmost simple selector, as a bucket key.
 *
 * Correctness requirement: a selector whose rightmost compound cannot be reduced
 * to an id, class, or tag must land in the universal bucket, where it is tested
 * against everything. Putting it in a specific bucket would silently drop rules
 * — the failure mode that reads as `unchanged`.
 *
 * The key is read from the compound outside its arguments and attribute
 * selectors. `:where(.docs-content h2)` names no class of the node it styles,
 * and keying it by `.docs-content` tested it only against the ancestor.
 */
function rightmostKey(selector: string): string {
  const compound = outsideArguments(lastCompound(selector));

  // An escape is consumed whole before a `#` or `.` can open a name, so the
  // `\#` in `.accent-\[\#ff4a19\]` stays inside the class.
  let id: string | undefined;
  let className: string | undefined;
  for (const [, sigil, name] of compound.matchAll(new RegExp(`${ESCAPE}|([#.])(${NAME})`, 'g'))) {
    if (sigil === '#') id ??= name;
    else if (sigil === '.') className ??= name;
  }
  if (id !== undefined) return `#${unescapeName(id)}`;
  if (className !== undefined) return `.${unescapeName(className)}`;

  const tag = /^([a-z][\w-]*)/i.exec(compound);
  if (tag && !compound.startsWith(':')) return tag[1]!.toLowerCase();

  if (compound.startsWith('[')) return '[attr]';

  return '*';
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

  // `@container`, `@scope`, and anything newer. Container queries in
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

export function isGroupingRule(rule: CSSRule): rule is CSSGroupingRule {
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
