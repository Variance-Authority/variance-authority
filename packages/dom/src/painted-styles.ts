import { GENERATED_BOXES } from './generated-box.js';
import { detectProfile } from './profile.js';

/**
 * Every computed style a subtree paints with: each element's, and each
 * generated box's where the host can read one — the subtree's, and its frame's.
 *
 * The frame is rendered too: the render rebuilds every ancestor by tag and
 * attributes and carries the rules that match it, so a `body::before` paints
 * above the subject in whatever face it names. An ancestor's own style paints
 * no text, because none of its text is rebuilt, and is not read here.
 *
 * One walk for every reader that asks what the subtree paints with, so the
 * asset key and the render document cannot disagree about which faces or files
 * a subject uses.
 *
 * A generated box can paint a file or a face the element's own styles do not
 * name. It is asked only of a host with a layout engine: `getComputedStyle(element,
 * '::before')` is unimplemented under jsdom, where it costs a virtual-console
 * error per element rather than an answer. The profile probe asks *can this
 * host resolve a pseudo-element's style*, not *is this jsdom*.
 *
 * A suite that stubs `getComputedStyle` -- to drive a layout it cannot
 * otherwise produce -- hands back a plain object with the two properties the
 * component under test reads. There is no computed style to scan, and there is
 * nothing to fail about: whatever it would have named, the stub has already
 * removed from the page.
 */
export function paintedStyles(root: Element): readonly CSSStyleDeclaration[] {
  const view = root.ownerDocument.defaultView;
  if (view === null) return [];

  const pseudo = detectProfile(view).layout ? GENERATED_BOXES : [];
  const styles: CSSStyleDeclaration[] = [];

  const read = (element: Element, selector: string | null): void => {
    const style = view.getComputedStyle(element, selector);
    if (typeof style?.getPropertyValue === 'function') styles.push(style);
  };

  for (const element of [root, ...root.querySelectorAll('*')]) {
    for (const selector of [null, ...pseudo]) read(element, selector);
  }
  for (let ancestor = root.parentElement; ancestor !== null; ancestor = ancestor.parentElement) {
    for (const selector of pseudo) read(ancestor, selector);
  }

  return styles;
}
