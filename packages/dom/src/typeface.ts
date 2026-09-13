import type { RawNode } from '@variance-authority/core/format';
/**
 * A text run whose font stack starts at a generic family.
 *
 * `font-family: monospace` is not a choice of typeface, it is a question put to
 * the host, and the host answers with whatever it considers monospace --
 * Menlo on one machine, Courier on the next, and in Chromium not always the
 * same answer in two renderer processes on the same machine. The glyphs then
 * differ while the markup, the styles and the computed `font-family` are all
 * identical, so nothing in the comparison can name the cause: this is the only
 * place where it is still visible.
 *
 * Only a stack whose *first* entry is generic is reported. `Menlo, monospace`
 * names a face and falls back to the host; that is a declaration with a safety
 * net, and warning about it would make the diagnostic noise.
 *
 * And only where the choice was made: a rule matching this element, an inline
 * style, or an element the user agent renders monospace. A generic inherited
 * from a page-level reset reaches every text run in every subject of the suite,
 * and a diagnostic that fires on all of them is wallpaper -- the subject that
 * actually asked for a host typeface would be indistinguishable from the rest.
 */
export function hostChosenFonts(
  root: RawNode,
): { readonly family: string; readonly more: number } | undefined {
  const GENERICS = new Set([
    'serif',
    'sans-serif',
    'monospace',
    'cursive',
    'fantasy',
    'system-ui',
    'ui-serif',
    'ui-sans-serif',
    'ui-monospace',
    'ui-rounded',
    'math',
    'emoji',
    'fangsong',
  ]);

  // Styled by the user agent as monospace, so the stack is generic without any
  // sheet in this document saying so. The author still chose the element.
  const UA_MONOSPACE = new Set(['kbd', 'code', 'samp', 'pre', 'tt', 'xmp', 'plaintext']);

  let first: string | undefined;
  let count = 0;

  const visit = (node: RawNode): void => {
    const family = node.computedStyle?.['font-family'];
    const chosenHere =
      UA_MONOSPACE.has(node.tag) ||
      node.inlineStyle?.['font-family'] !== undefined ||
      node.matchedRules.some((rule) =>
        rule.declarations.some((declaration) => declaration.property === 'font-family'),
      );
    if (
      family !== undefined &&
      chosenHere &&
      node.children.some((child) => child.tag === '#text' && (child.text ?? '').trim() !== '')
    ) {
      const leading = family.split(',')[0]!.trim().replace(/^["']|["']$/g, '').toLowerCase();
      if (GENERICS.has(leading)) {
        first ??= leading;
        count += 1;
      }
    }
    for (const child of node.children) visit(child);
    for (const child of node.shadowChildren ?? []) visit(child);
  };

  visit(root);

  return first === undefined ? undefined : { family: first, more: count - 1 };
}
