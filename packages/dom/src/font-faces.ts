import { pageOrigin, withoutOrigin } from '@variance-authority/core/format';
import { items } from './dom-list.js';
import { GENERATED_BOXES } from './generated-box.js';
import { detectProfile } from './profile.js';

/**
 * The `@font-face` rules a subject is set in.
 *
 * Applicability pruning keeps the rules that match an element, and a face
 * matches none: it names a file, and the element names the face. Pruned with
 * the rest, it left a render document whose `font-family` asked for a face
 * nobody declared — which every renderer answers with whatever it has
 * installed. So a page that ships its own font was painted in the fallback, and
 * a change to that font moved no image.
 *
 * A face is carried when a family it declares is in the computed `font-family`
 * of something in the subtree, which is the pruning question asked of the one
 * rule that cannot be asked it directly. Its files are named against the page,
 * not against the sheet that declared them, because the render document has one
 * inline sheet and a base: `url(../fonts/a.woff2)` written in
 * `/assets/site.css` resolves against the page there, and fetches nothing.
 */

export interface IndexedFace {
  /** The family the face answers for, folded the way family names match. */
  readonly family: string;
  /** The rule as the render document carries it, every `url()` against the page. */
  readonly text: string;
  /** Every file the face names, absolute. */
  readonly sources: readonly string[];
  /**
   * Whether the host kept the face's `src`.
   *
   * jsdom's CSSOM keeps `font-family` on a face and nothing else, so a face read
   * there declares a family and no file. Carrying it would paint the fallback
   * under a declaration that says otherwise.
   */
  readonly readable: boolean;
}

export function isFontFaceRule(rule: CSSRule): rule is CSSFontFaceRule {
  return rule.constructor.name === 'CSSFontFaceRule';
}

/**
 * One face, read from the sheet it sits in.
 *
 * `base` is what the sheet's own relative URLs resolve against: its `href`, or
 * the document's base for a sheet with none.
 */
export function faceOf(rule: CSSFontFaceRule, base: string, document: Document): IndexedFace | null {
  const family = familiesIn(rule.style.getPropertyValue('font-family'))[0];
  if (family === undefined) return null;

  const origin = pageOrigin(document.baseURI);
  const sources: string[] = [];
  const text = rule.cssText.replace(URL_TOKEN, (token, double?: string, single?: string, bare?: string) => {
    const written = double ?? single ?? bare ?? '';
    if (written === '' || /^data:/i.test(written)) return token;

    let resolved: string;
    try {
      resolved = new URL(written, base).toString();
    } catch {
      return token;
    }
    sources.push(resolved);
    return `url("${withoutOrigin(resolved, origin)}")`;
  });

  return { family, text, sources, readable: rule.style.getPropertyValue('src') !== '' };
}

const URL_TOKEN = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/g;

/** The faces a subtree is set in, in the order the document declared them. */
export function facesUsedBy(root: Element, faces: readonly IndexedFace[]): readonly IndexedFace[] {
  if (faces.length === 0) return [];
  const used = familiesUsedBy(root);
  return faces.filter((face) => used.has(face.family));
}

/**
 * The files of every face the subtree is set in, conditions or not.
 *
 * For the asset key, which is asked of the live page with no environment to
 * erase a condition against. A face under an `@media` that does not hold here
 * is counted anyway: a key naming a file the render will not fetch costs a
 * render nobody needed, and one missing a file the render paints with is a
 * false `unchanged`.
 */
export function faceSourcesUsedBy(root: Element, sheets: readonly CSSStyleSheet[]): readonly string[] {
  const document = root.ownerDocument;
  const faces: IndexedFace[] = [];

  const walk = (rules: CSSRuleList, base: string): void => {
    for (const rule of items(rules)) {
      if (isFontFaceRule(rule)) {
        const face = faceOf(rule, base, document);
        if (face !== null) faces.push(face);
      } else if ('cssRules' in rule && !('selectorText' in rule)) {
        walk((rule as CSSGroupingRule).cssRules, base);
      }
    }
  };

  for (const sheet of sheets) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      // Cross-origin. The index reports it; nothing in it can be read here.
      continue;
    }
    walk(rules, sheet.href ?? document.baseURI);
  }

  return facesUsedBy(root, faces).flatMap((face) => face.sources);
}

/**
 * Every family named in the computed `font-family` of the subtree.
 *
 * The whole stack, not the face that won: which entry a glyph is drawn from is
 * the renderer's to decide from the faces it holds, and a face left out because
 * an earlier entry was installed here is a face missing wherever it is not.
 */
function familiesUsedBy(root: Element): ReadonlySet<string> {
  const view = root.ownerDocument.defaultView;
  const used = new Set<string>();
  if (view === null) return used;

  // As `referencedAssets` asks it, and for the same reason: jsdom costs a
  // virtual-console error per element for a pseudo-element's style.
  const pseudo = detectProfile(view).layout ? GENERATED_BOXES : [];

  for (const element of [root, ...root.querySelectorAll('*')]) {
    for (const selector of [null, ...pseudo]) {
      const style = view.getComputedStyle(element, selector);
      if (typeof style?.getPropertyValue !== 'function') continue;
      for (const family of familiesIn(style.getPropertyValue('font-family'))) used.add(family);
    }
  }

  return used;
}

/**
 * `"Brand Sans", Inter, monospace` → `['brand sans', 'inter', 'monospace']`.
 *
 * Split on the commas outside quotes, unquoted, and lower-cased, because family
 * names match without regard to ASCII case.
 */
function familiesIn(value: string): readonly string[] {
  const families: string[] = [];
  for (const match of value.matchAll(/\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^,]+))\s*(?:,|$)/g)) {
    const family = (match[1] ?? match[2] ?? match[3] ?? '').replace(/\\(.)/g, '$1').trim().toLowerCase();
    if (family !== '') families.push(family.replace(/\s+/g, ' '));
  }
  return families;
}
