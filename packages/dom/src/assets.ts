import { pageOrigin, withoutOrigin } from '@variance-authority/core/format';
import { authoredSheets, isGroupingRule } from './css-index.js';
import { urlsIn } from './css-url.js';
import { items } from './dom-list.js';
import { faceOf, familiesPaintedWith, isFontFaceRule } from './font-faces.js';
import { paintedStyles } from './painted-styles.js';

/**
 * Which external files a subject's own subtree asks for.
 *
 * The other half of watching the wire. The driver is the only party that sees an
 * asset's *bytes*, and it sees them per **page**: a request carries no idea which
 * subject will end up using it. That is fine for a collector that navigates per
 * subject and wrong for one that does not — a Storybook run mounts three hundred
 * stories into one document, so the page's asset set at the moment story 200 is
 * read depends on which stories ran before it. Fold that into the environment key
 * and sharding a suite changes every key in it, which is not over-invalidation,
 * it is **order dependence in the identity a baseline is stored under**.
 *
 * So the page answers the half only it can answer: given this subtree, which URLs
 * does it reference? The driver's observation is then narrowed to that set, and
 * the key becomes a function of the subject's own document — the same value
 * whichever order the suite ran in, and on a machine that ran nothing else.
 *
 * **A URL nothing requested is simply absent.** No entry is invented for it: an
 * asset that was served from the browser's cache before the observation started
 * has no bytes anybody here saw, and a placeholder would be a claim about
 * content. What the absence costs is stated where the collectors use this —
 * a hole in the key is a false `unchanged`, so the collectors report it.
 */

/**
 * Style properties whose value can name a file.
 *
 * `content` is here because `::before { content: url(icon.svg) }` paints an image
 * with no element to hang an attribute on. `cursor` is here because a custom
 * cursor is a fetched file, and although it is almost never in a screenshot, an
 * asset set that quietly excluded a category would be a set nobody can reason
 * about — the rule is "everything the subtree fetches", not "everything visible".
 */
const URL_PROPERTIES: readonly string[] = [
  'background-image',
  'border-image-source',
  'list-style-image',
  'mask-image',
  '-webkit-mask-image',
  'shape-outside',
  'content',
  'cursor',
];

/**
 * Every asset URL the subtree references, absolute, sorted, de-duplicated.
 *
 * Sorted because the result is folded into a digest through an object key order
 * nobody should have to reason about, and a list whose order depends on document
 * traversal is a list that will one day differ for a reason nobody can name.
 *
 * Schemes that carry their own bytes — `data:` — are excluded: the bytes are
 * already in the document, so hashing them again would put the same information
 * in the key twice and make an inline SVG look like a fetch. `blob:` and
 * `about:` are excluded because nothing on the wire corresponds to them.
 */
export function referencedAssets(root: Element): readonly string[] {
  const document = root.ownerDocument;
  const found = new Set<string>();

  const add = (value: string | null | undefined): void => {
    if (value === null || value === undefined) return;
    const trimmed = value.trim();
    if (trimmed === '') return;

    let resolved: string;
    try {
      resolved = new URL(trimmed, document.baseURI).toString();
    } catch {
      // A malformed URL is the page's business, not ours. It fetches nothing, so
      // it belongs in no key.
      return;
    }

    if (/^(data|blob|about|javascript):/i.test(resolved)) return;
    found.add(resolved);
  };

  for (const element of [root, ...root.querySelectorAll('*')]) addAttributes(element, add);

  const styles = paintedStyles(root);
  for (const style of styles) {
    for (const property of URL_PROPERTIES) {
      for (const url of urlsIn(style.getPropertyValue(property))) add(url);
    }
  }

  // A face's file is named by a rule no element matches, so no computed value
  // above carries it; the subtree asks for it by setting text in the face.
  for (const source of faceSources(familiesPaintedWith(styles), document)) add(source);

  return [...found].sort();
}

/**
 * The attributes that name a file, by element.
 *
 * `href` is read only on SVG's `<use>` and `<image>`. On an `<a>` it is a
 * destination rather than an asset, and hashing every link target would put the
 * whole site in one subject's key.
 */
function addAttributes(element: Element, add: (value: string | null) => void): void {
  const tag = element.tagName.toLowerCase();

  if (tag === 'img' || tag === 'source') {
    add(element.getAttribute('src'));
    // **Every candidate, not the one the browser picked.** Which candidate is
    // used depends on the device pixel ratio, and a key that recorded only the
    // chosen one would let a 2× asset change without moving the 1× runner's key
    // — the same file, the same URL list, and a baseline that is quietly of
    // different bytes. Over-inclusion here costs a re-render nobody needed;
    // under-inclusion costs a false `unchanged`.
    for (const candidate of srcsetCandidates(element.getAttribute('srcset'))) add(candidate);
  }

  if (tag === 'image' || tag === 'use') {
    add(element.getAttribute('href'));
    add(element.getAttributeNS('http://www.w3.org/1999/xlink', 'href'));
  }

  if (tag === 'video' || tag === 'audio' || tag === 'track' || tag === 'embed' || tag === 'iframe') {
    add(element.getAttribute('src'));
  }

  if (tag === 'video') add(element.getAttribute('poster'));
  if (tag === 'object') add(element.getAttribute('data'));
  if (tag === 'input' && element.getAttribute('type')?.toLowerCase() === 'image') {
    add(element.getAttribute('src'));
  }
}

/** `a.png 1x, b.png 2x` → `['a.png', 'b.png']`. Descriptors are not URLs. */
function srcsetCandidates(value: string | null): readonly string[] {
  if (value === null) return [];

  return value
    .split(',')
    .map((candidate) => candidate.trim().split(/\s+/)[0] ?? '')
    .filter((candidate) => candidate !== '');
}

/**
 * The files of every face named in `families`, conditions or not.
 *
 * A face under an `@media` that does not hold here is counted anyway, because the key is asked
 * of the live page with no environment to erase a condition against: a key
 * naming a file the render will not fetch costs a render nobody needed, and
 * one missing a file the render paints with is a false `unchanged`.
 *
 * A walk of its own rather than the index's, because the index is built per
 * environment and erases what does not hold in it.
 */
function faceSources(families: ReadonlySet<string>, document: Document): readonly string[] {
  if (families.size === 0) return [];
  const sources: string[] = [];

  const walk = (rules: CSSRuleList, base: string): void => {
    for (const rule of items(rules)) {
      if (isFontFaceRule(rule)) {
        const face = faceOf(rule, base, document);
        if (face !== null && families.has(face.family)) sources.push(...face.sources);
      } else if (isGroupingRule(rule)) {
        walk(rule.cssRules, base);
      }
    }
  };

  for (const sheet of authoredSheets(document)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      // Cross-origin. The index reports it; nothing in it can be read here.
      continue;
    }
    walk(rules, sheet.href ?? document.baseURI);
  }

  return sources;
}

/**
 * The observed assets, narrowed to the ones this subject references.
 *
 * Where the two halves meet: the driver knows the bytes and the page knows the
 * subject. Returned as a plain object because that is what `EnvironmentInputs`
 * carries, and built in referenced order so the shape is stable.
 *
 * An asset the page's own origin serves is keyed by its path. A collector serves
 * a build on whatever port the machine had free, and a key holding that port
 * makes one build served twice two environments. An asset from another origin
 * keeps its absolute URL, because there the host is part of what was fetched.
 */
export function assetsFor(
  root: Element,
  observed: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const scoped: Record<string, string> = {};
  const origin = pageOrigin(root.ownerDocument.baseURI);

  for (const url of referencedAssets(root)) {
    const digest = observed[url];
    if (digest === undefined) continue;
    scoped[withoutOrigin(url, origin)] = digest;
  }

  return scoped;
}
