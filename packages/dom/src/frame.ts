import type { FrameElement, RenderDocument } from '@variance-authority/core/format';
import { attributesOf } from './dom-list.js';
import type { ObjectUrls } from './object-urls.js';

/** Tags, ids, classes and attributes above the subject, outermost first. */
export function frameOf(root: Element, urls: ObjectUrls): RenderDocument['frame'] {
  const ownerDocument = root.ownerDocument;
  const ancestors: FrameElement[] = [];

  for (let node = root.parentElement; node !== null; node = node.parentElement) {
    const tag = node.tagName.toLowerCase();
    if (tag === 'html' || tag === 'body') continue;
    ancestors.unshift({ tag, attributes: framed(node, urls) });
  }

  // Zero under a profile with no layout engine, and omitted rather than recorded
  // as `0` — a container width of zero is a claim, and an unobservable one must
  // never be reported as an observed value (ADR-0002).
  const containerWidth = root.parentElement === null ? 0 : usedWidth(root.parentElement);

  return {
    html: ownerDocument.documentElement ? framed(ownerDocument.documentElement, urls) : {},
    body: ownerDocument.body ? framed(ownerDocument.body, urls) : {},
    ancestors,
    ...(containerWidth > 0 ? { containerWidth } : {}),
  };
}

/**
 * `element`'s used `width`, measured as its own `box-sizing` measures it, so the
 * render can write it back on the same box and lay out the same content box: the
 * one a percentage width below it resolves against. Its bounding box is wider by
 * padding and border, and a body padded by a class painted its subject that much
 * wider than the page laid it out. Zero when nothing was laid out.
 */
function usedWidth(element: Element): number {
  if (element.getBoundingClientRect().width === 0) return 0;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  const width = Number.parseFloat(style?.width ?? '');
  return Number.isFinite(width) && width > 0 ? width : 0;
}

/**
 * `element`'s attributes, object URLs carried and classes in code-unit order: a
 * class selector reads them as a set, and their order is the page's history.
 * Storybook swaps its layout class on a page it reuses, so each neighbour gave
 * a story a different document. Only `[class^=…]` tells the orders apart.
 */
function framed(element: Element, urls: ObjectUrls): Record<string, string> {
  const attributes = attributesOf(element);
  for (const edit of urls.editsOf(element)) {
    attributes[element.getAttributeNodeNS(edit.namespace, edit.name)?.name ?? edit.name] = edit.value;
  }
  const classes = attributes['class'];
  if (classes !== undefined) {
    attributes['class'] = [...new Set(classes.split(/\s+/).filter((name) => name !== ''))].sort().join(' ');
  }
  return attributes;
}
