// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { RawNode, Viewport } from '@variance-authority/core/format';
import { normalize } from '@variance-authority/core/rules';
import { collect } from './collect.js';
import { GENERATED_BOX_UNREAD, contentText } from './generated-box.js';
import { splitPseudoElement } from './selector-parts.js';

/**
 * The boxes `::before` and `::after` generate, read without a layout engine.
 *
 * JSDOM computes no generated content, so what this host can say is which rules
 * style a box and whether the cascade gives it content — never whether it
 * renders or what it says. The engine's half is in
 * `route-collector/src/pseudo-elements.chromium.test.ts`, against real pixels.
 */

const VIEWPORT: Viewport = { width: 1280, height: 720, deviceScaleFactor: 1, colorScheme: 'light' };

const options = {
  subject: { id: 'story:badge--new', kind: 'fixture' as const },
  viewport: VIEWPORT,
  engine: 'jsdom@test',
  fonts: ['Inter/400/normal/deadbeef'],
};

function badge(css: string): RawNode {
  document.head.innerHTML = `<style>${css}</style>`;
  document.body.innerHTML = `<div id="canvas"><span class="badge">3</span></div>`;
  return collect(document.getElementById('canvas')!, options).root.children[0]!;
}

describe('a generated box under a host without a layout engine', () => {
  it('is a child styled by its own rules, marked unread', () => {
    const host = badge(`.badge { padding: 2px; } .badge::before { content: "New"; color: red; }`);

    expect(host.children.map((child) => child.tag)).toEqual(['::before', '#text']);
    expect(host.matchedRules.map((rule) => rule.selector)).toEqual(['.badge']);

    const box = host.children[0]!;
    expect(box.matchedRules.map((rule) => rule.selector)).toEqual(['.badge::before']);
    expect(box.unread).toBe(GENERATED_BOX_UNREAD);
    expect(box.computedStyle).toBeUndefined();
    expect(box.children).toEqual([]);
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

  it('moves the snapshot when its declared colour changes', () => {
    const hashOf = (css: string): string => {
      badge(css);
      return normalize(collect(document.getElementById('canvas')!, options)).renderHash;
    };

    expect(hashOf(`.badge::before { content: "New"; color: red; }`)).not.toBe(
      hashOf(`.badge::before { content: "New"; color: blue; }`),
    );
  });
});

describe('the text a computed content says', () => {
  it('joins strings and resolves their escapes', () => {
    expect(contentText(String.raw`"New"`)).toBe('New');
    expect(contentText(String.raw`"a" " - " "b"`)).toBe('a - b');
    expect(contentText(String.raw`"say \"hi\" \\ \41 B"`)).toBe('say "hi" \\ AB');
    expect(contentText(`""`)).toBe('');
  });

  it('carries anything the engine did not resolve to a string as written', () => {
    expect(contentText(`counter(item) ". "`)).toBe(`counter(item) ". "`);
    expect(contentText('open-quote')).toBe('open-quote');
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
