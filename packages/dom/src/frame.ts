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
  const containerWidth = root.parentElement === null ? 0 : contentWidth(root.parentElement);

  return {
    html: ownerDocument.documentElement ? framed(ownerDocument.documentElement, urls) : {},
    body: ownerDocument.body ? framed(ownerDocument.body, urls) : {},
    ancestors,
    ...(containerWidth > 0 ? { containerWidth } : {}),
  };
}

/**
 * The width of `element`'s content box: what a percentage width below it resolves
 * against. Its border box is wider by its padding and border, and a body padded
 * by a class painted its subject that much wider than the page laid it out.
 */
function contentWidth(element: Element): number {
  const width = element.getBoundingClientRect().width;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (width === 0 || style === undefined) return width;
  const edges = ['padding-left', 'padding-right', 'border-left-width', 'border-right-width']
    .map((property) => Number.parseFloat(style.getPropertyValue(property)) || 0)
    .reduce((sum, edge) => sum + edge, 0);
  return Math.max(0, width - edges);
}

/** `element`'s attributes, by qualified name, with each object URL in them carried. */
function framed(element: Element, urls: ObjectUrls): Record<string, string> {
  const attributes = attributesOf(element);
  for (const edit of urls.editsOf(element)) {
    attributes[element.getAttributeNodeNS(edit.namespace, edit.name)?.name ?? edit.name] = edit.value;
  }
  return attributes;
}
