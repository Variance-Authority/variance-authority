import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { indexStyleSheets, matchRulesFor } from './css.js';

/**
 * Which bucket a rule is filed under, asked through the only thing that reads
 * the buckets: whether the rule reaches the element it matches.
 *
 * The index files each rule by its rightmost simple selector, and an element is
 * tested only against the buckets its own id, classes and tag name key into. A
 * key read from inside an argument or an attribute value names a different
 * element than the rule styles, so the rule is never tested against the one it
 * matches and the render paints the page without it. The images then disagree
 * with the live page, and every region is placed against boxes the render does
 * not have.
 */

const ENVIRONMENT = { width: 1280, height: 720, deviceScaleFactor: 1, colorScheme: 'light' as const };

function matched(css: string, html: string, selector: string): readonly string[] {
  const dom = new JSDOM(`<!doctype html><html><head><style>${css}</style></head><body>${html}</body></html>`);
  const document = dom.window.document as unknown as Document;
  const index = indexStyleSheets(document, ENVIRONMENT);
  return matchRulesFor(document.querySelector(selector)!, index).matched.map((rule) => rule.selector);
}

describe('a rule reaches the element its rightmost compound names', () => {
  it('files a :where() wrapping a descendant selector by what is outside the argument', () => {
    const css = ':where(.docs-content h2) { margin-top: 3rem }';
    expect(matched(css, '<main class="docs-content"><h2>Title</h2></main>', 'h2')).toEqual([
      ':where(.docs-content h2)',
    ]);
  });

  it('files an :is() argument the same way', () => {
    const css = ':is(.docs-content :not(pre) > code) { font-size: 0.9em }';
    expect(matched(css, '<main class="docs-content"><p><code>x</code></p></main>', 'code')).toEqual([
      ':is(.docs-content :not(pre) > code)',
    ]);
  });

  it('files a tag carrying a :not() by the tag, not by the class it excludes', () => {
    const css = 'a:not(.plain) { text-decoration: underline }';
    expect(matched(css, '<a href="/x">x</a>', 'a')).toEqual(['a:not(.plain)']);
  });

  it('reads no id or class out of an attribute value', () => {
    const css = 'a[href="#top"] { color: red } a[href$=".pdf"] { color: blue }';
    expect(matched(css, '<a href="#top">top</a>', 'a')).toEqual(['a[href="#top"]']);
    expect(matched(css, '<a href="/x.pdf">pdf</a>', 'a')).toEqual(['a[href$=".pdf"]']);
  });

  it('still files an escaped class by the class', () => {
    const css = '.md\\:w-\\[10px\\] { width: 10px }';
    expect(matched(css, '<div class="md:w-[10px]"></div>', 'div')).toEqual(['.md\\:w-\\[10px\\]']);
  });

  // An escaped combinator is a character of the class, not a break before the
  // compound: read as a break, the rule was filed under `.b` and never tested.
  it('files a class with an escaped combinator by the whole class', () => {
    const css = '.a\\+b { color: red }';
    expect(matched(css, '<div class="a+b"></div>', 'div')).toEqual(['.a\\+b']);
  });

  // The CSSOM writes a class that starts with a digit as a hex escape, and the
  // space that ends the escape is part of it: read as a descendant combinator,
  // every `2xl:` rule of a Tailwind page was filed under `xl` and never tested.
  it('files a class written with a hex escape by the whole class', () => {
    const css = '.\\32 xl\\:p-4 { padding: 1rem }';
    expect(matched(css, '<div class="2xl:p-4"></div>', 'div')).toEqual(['.\\32 xl\\:p-4']);
  });

  it('files an escaped id by the whole id', () => {
    const css = '#a\\:b { color: red }';
    expect(matched(css, '<div id="a:b"></div>', 'div')).toEqual(['#a\\:b']);
  });

  it('files a class holding an escaped # by the class, never as an id', () => {
    // Tailwind's arbitrary colours, `accent-[#ff4a19]`, are written this way.
    const css = '.accent-\\[\\#ff4a19\\] { color: red }';
    expect(matched(css, '<div class="accent-[#ff4a19]"></div>', 'div')).toEqual([
      '.accent-\\[\\#ff4a19\\]',
    ]);
  });
});
