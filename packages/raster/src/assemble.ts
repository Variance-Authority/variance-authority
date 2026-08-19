import type { RenderDocument } from '@variance-authority/core';

/**
 * Assembly — the render document becomes a page.
 *
 * Kept pure and kept separate. This is the step where an acquisition mistake
 * turns into a wrong image, and a wrong image is the most expensive artifact
 * this system can produce: it looks like evidence. So it is a string in, a string
 * out, with no browser anywhere near it, which means the question "would this
 * document paint what was acquired?" can be asked in a unit test.
 *
 * The renderer does not get to make decisions here. Everything that could move a
 * pixel is either in the document or is one of the four adjustments below, each
 * of which is stated rather than assumed.
 */

/** Marks the element the screenshot is clipped to — the subject root. */
export const SUBJECT_PATH = '0';

export interface AssembleOptions {
  /**
   * Extra CSS appended after everything else.
   *
   * For the caller who has to defeat something the document cannot describe —
   * an animation, a caret, a `::selection` — and who should be the one deciding
   * to, not this function.
   */
  readonly extraCss?: string;
}

export function assemble(document: RenderDocument, options: AssembleOptions = {}): string {
  return [
    '<!doctype html>',
    `<html${attributes(document.frame.html)}>`,
    '<head><meta charset="utf-8">',
    ...(document.baseUrl === undefined
      ? []
      : [`<base href="${escapeAttribute(document.baseUrl)}">`]),
    `<style>${sheet(document, options)}</style>`,
    '</head>',
    `<body${attributes(document.frame.body)}>`,
    ...document.frame.ancestors.map((ancestor, index) =>
      // The container's used width is reproduced inline on the innermost
      // ancestor, because that is the box a percentage width resolves against.
      // Without it a subject declaring `width: 100%` renders at viewport width
      // regardless of the panel it actually lived in.
      index === document.frame.ancestors.length - 1 && document.frame.containerWidth !== undefined
        ? `<${ancestor.tag}${withWidth(ancestor.attributes, document.frame.containerWidth)}>`
        : `<${ancestor.tag}${attributes(ancestor.attributes)}>`,
    ),
    document.html,
    ...[...document.frame.ancestors].reverse().map((ancestor) => `</${ancestor.tag}>`),
    '</body></html>',
  ].join('');
}

/**
 * The stylesheet, in cascade order, with the inherited floor first.
 *
 * Order is the whole content of this function. The inherited values must lose
 * to anything the document declares, which they do by sitting on `:root` and
 * reaching the subject only by inheritance — inheritance loses to every
 * declaration on the element itself, so this cannot override the subject no
 * matter what its specificity looks like.
 */
function sheet(document: RenderDocument, options: AssembleOptions): string {
  const inherited = Object.entries(document.inherited)
    .map(([property, value]) => `${property}:${value}`)
    .join(';');

  return [
    // The page's own margin, not the subject's. Reproducing the browser default
    // would offset the clip box by 8px and change nothing else, so it is removed
    // rather than carried; the subject's position on the page is not what is
    // being compared.
    'html,body{margin:0;padding:0}',
    ...(document.frame.containerWidth !== undefined
      ? [`body{width:${document.frame.containerWidth}px}`]
      : []),
    ...(inherited !== '' ? [`:root{${inherited}}`] : []),
    ...document.css,
    ...(options.extraCss !== undefined ? [options.extraCss] : []),
  ].join('\n');
}

function attributes(record: Readonly<Record<string, string>>): string {
  return Object.entries(record)
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
    .join('');
}

function withWidth(record: Readonly<Record<string, string>>, width: number): string {
  const existing = record['style'];
  return attributes({
    ...record,
    style: `${existing !== undefined ? `${existing};` : ''}width:${width}px`,
  });
}

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}
