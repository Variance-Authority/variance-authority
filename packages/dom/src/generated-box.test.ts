// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { JSDOM_PROFILE, type MatchedRule, type RawNode, type Viewport } from '@variance-authority/core/format';
import { normalize } from '@variance-authority/core/rules';
import { collect } from './collect.js';
import { generatedBox, readContent } from './generated-box.js';
import { splitPseudoElement } from './selector-parts.js';

/**
 * The boxes `::before` and `::after` generate, read without a layout engine.
 *
 * JSDOM computes no generated content, so what this host reads is the cascade:
 * which rules style a box, and the `content` that wins among them. Strings and
 * `attr()` say their words without an engine; a counter, a quote or a `var()`
 * does not, and the box says which it could not read. The engine's half is in
 * `route-collector/src/pseudo-elements.chromium.test.ts`, against real pixels.
 */

const VIEWPORT: Viewport = { width: 1280, height: 720, deviceScaleFactor: 1, colorScheme: 'light' };

const options = {
  subject: { id: 'story:badge--new', kind: 'fixture' as const },
  viewport: VIEWPORT,
  engine: 'jsdom@test',
  fonts: ['Inter/400/normal/deadbeef'],
};

function badge(css: string, attributes = ''): RawNode {
  document.head.innerHTML = `<style>${css}</style>`;
  document.body.innerHTML = `<div id="canvas"><span class="badge"${attributes}>3</span></div>`;
  return collect(document.getElementById('canvas')!, options).root.children[0]!;
}

function hashOf(css: string, attributes = ''): string {
  badge(css, attributes);
  return normalize(collect(document.getElementById('canvas')!, options)).renderHash;
}

const textsOf = (node: RawNode): (string | undefined)[] => node.children.map((child) => child.text);

describe('a generated box under a host without a layout engine', () => {
  it('is a child styled by its own rules, saying the words its content declares', () => {
    const host = badge(`.badge { padding: 2px; } .badge::before { content: "New"; color: red; }`);

    expect(host.children.map((child) => child.tag)).toEqual(['::before', '#text']);
    expect(host.matchedRules.map((rule) => rule.selector)).toEqual(['.badge']);

    const box = host.children[0]!;
    expect(box.matchedRules.map((rule) => rule.selector)).toEqual(['.badge::before']);
    expect(box.unread).toBeUndefined();
    expect(box.computedStyle).toBeUndefined();
    expect(box.children.map((child) => child.tag)).toEqual(['#text']);
    expect(textsOf(box)).toEqual(['New']);
  });

  it('moves the snapshot when its declared words change', () => {
    expect(hashOf(`.badge::before { content: "New"; }`)).not.toBe(
      hashOf(`.badge::before { content: "Old"; }`),
    );
  });

  it("says an attribute's value when its content reads one from the element", () => {
    const host = badge(`.badge::after { content: " (" attr(data-unit) ")"; }`, ' data-unit="items"');

    expect(textsOf(host.children[1]!)).toEqual([' (items)']);
    expect(hashOf(`.badge::after { content: "per " attr(data-unit); }`, ' data-unit="items"')).not.toBe(
      hashOf(`.badge::after { content: "per " attr(data-unit); }`, ' data-unit="rows"'),
    );
  });

  // JSDOM's CSS parser drops `content: attr(x)` and `content: counter(x)` when
  // the function is the whole value: the rule reaches the capture with no
  // declaration, so there is no box and nothing to mark.
  it.todo(
    'reads a content that is one attr() or counter() alone — needs the declaration read from the stylesheet text JSDOM parsed',
  );

  it('is marked unread, naming what it could not resolve, when its content needs an engine', () => {
    const host = badge(`.badge::before { content: counter(item) ". "; }`);

    const box = host.children[0]!;
    expect(box.tag).toBe('::before');
    expect(box.children).toEqual([]);
    expect(box.unread).toContain('counter()');
  });

  it('is not made when its winning display is none', () => {
    const host = badge(`.badge::before { content: "New"; display: none; }`);

    expect(host.children.map((child) => child.tag)).toEqual(['#text']);
  });

  it('is read from the single-colon spelling CSS 2 wrote, which JSDOM keeps', () => {
    const host = badge(`.badge:after { content: "!"; }`);

    expect(host.children.map((child) => child.tag)).toEqual(['#text', '::after']);
  });

  it('is not made by a rule that styles every box without giving one content', () => {
    const host = badge(`*, *::before, *::after { box-sizing: border-box; }`);

    expect(host.children.map((child) => child.tag)).toEqual(['#text']);
  });

  it('is not made when the winning content is none', () => {
    const host = badge(`.badge::before { content: "New"; } span.badge::before { content: none; }`);

    expect(host.children.map((child) => child.tag)).toEqual(['#text']);
  });

  it('says the later of two contents one rule declares, as the cascade picks between them', () => {
    // CSSOM keeps one declaration per property, so a rule read from it never
    // holds two. A rule read from stylesheet text does, and there document order
    // within the rule decides, exactly as it does between rules of one specificity.
    document.body.innerHTML = `<span class="badge">3</span>`;
    const rule: MatchedRule = {
      sheet: 'inline-sheet',
      selector: '.badge::before',
      specificity: [0, 1, 0],
      order: 1,
      declarations: [
        { property: 'content', value: '"Old"', important: false },
        { property: 'content', value: '"New"', important: false },
      ],
    };

    const box = generatedBox(document.body.firstElementChild!, '::before', [rule], JSDOM_PROFILE, null, undefined);

    expect(textsOf(box!)).toEqual(['New']);
  });

  it('moves the snapshot when its declared colour changes', () => {
    expect(hashOf(`.badge::before { content: "New"; color: red; }`)).not.toBe(
      hashOf(`.badge::before { content: "New"; color: blue; }`),
    );
  });
});

describe('the words a content says', () => {
  const host = (): Element => {
    document.body.innerHTML = `<span data-unit="items" data-empty=""></span>`;
    return document.body.firstElementChild!;
  };

  it('joins strings and resolves their escapes', () => {
    expect(readContent(String.raw`"New"`, host())).toEqual({ text: 'New' });
    expect(readContent(String.raw`"a" ' - ' "b"`, host())).toEqual({ text: 'a - b' });
    expect(readContent(String.raw`"say \"hi\" \\ \41 B"`, host())).toEqual({ text: 'say "hi" \\ AB' });
    expect(readContent(`""`, host())).toEqual({ text: '' });
  });

  it('reads an escape that names no character as the replacement character, as CSS syntax does', () => {
    expect(readContent(String.raw`"\0"`, host())).toEqual({ text: '\ufffd' });
    expect(readContent(String.raw`"\110000"`, host())).toEqual({ text: '\ufffd' });
    expect(readContent(String.raw`"\D800"`, host())).toEqual({ text: '\ufffd' });
  });

  it('reads a string the value leaves open to the end, as CSS syntax closes it', () => {
    expect(readContent(`"New`, host())).toEqual({ text: 'New' });
  });

  it('names what it cannot read as a part, rather than dropping it', () => {
    expect(readContent(`"a" ( "b"`, host())).toEqual({ unresolved: ['( "b"'] });
  });

  it("reads attr() from the element, and an attribute it lacks as nothing", () => {
    expect(readContent(`"(" attr(data-unit) ")"`, host())).toEqual({ text: '(items)' });
    expect(readContent(`attr(data-missing) "x"`, host())).toEqual({ text: 'x' });
  });

  it('leaves out the alternative text after a slash, which is not painted', () => {
    expect(readContent(`"★" / "starred"`, host())).toEqual({ text: '★' });
  });

  it('names each part only a layout engine or a runtime resolves', () => {
    expect(readContent(`counter(item) ". "`, host())).toEqual({ unresolved: ['counter()'] });
    expect(readContent('open-quote', host())).toEqual({ unresolved: ['open-quote'] });
    expect(readContent(`var(--label) url(a.png)`, host())).toEqual({ unresolved: ['var()', 'url()'] });
    expect(readContent(`attr(data-unit, "none")`, host())).toEqual({ unresolved: ['attr()'] });
  });
});

describe('a selector cut at its pseudo-element', () => {
  it('splits the host from a trailing pseudo-element, in either spelling', () => {
    expect(splitPseudoElement('.badge::before')).toEqual({ host: '.badge', pseudo: '::before' });
    expect(splitPseudoElement('.badge:AFTER')).toEqual({ host: '.badge', pseudo: '::after' });
    expect(splitPseudoElement('li::marker')).toEqual({ host: 'li', pseudo: '::marker' });
  });

  it('gives a pseudo-element with no host the universal one it implied', () => {
    expect(splitPseudoElement('::before')).toEqual({ host: '*', pseudo: '::before' });
    expect(splitPseudoElement('.card ::before')).toEqual({ host: '.card *', pseudo: '::before' });
    expect(splitPseudoElement('.card > ::after')).toEqual({ host: '.card > *', pseudo: '::after' });
  });

  it('leaves alone what selects an element', () => {
    expect(splitPseudoElement('.badge')).toBeNull();
    expect(splitPseudoElement('a:hover')).toBeNull();
    expect(splitPseudoElement('x-card::part(label)')).toBeNull();
    expect(splitPseudoElement('.a\\:before')).toBeNull();
    expect(splitPseudoElement(':is(.a::before)')).toBeNull();
  });
});
