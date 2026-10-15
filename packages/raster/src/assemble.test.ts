import { describe, expect, it } from 'vitest';
import type { RenderDocument, Viewport } from '@variance-authority/core/format';
import { assemble } from './assemble.js';

/**
 * Assembly, with no browser in sight.
 *
 * This is where an acquisition mistake becomes a wrong image, and a wrong image
 * is the most expensive artifact the system can produce because it looks like
 * evidence. Being a pure string-to-string function is what makes that testable
 * at all.
 */

const VIEWPORT: Viewport = { width: 800, height: 600, deviceScaleFactor: 1, colorScheme: 'light' };

function documentOf(overrides: Partial<RenderDocument> = {}): RenderDocument {
  return {
    documentVersion: 1,
    subject: { id: 's', kind: 'fixture' },
    html: '<div data-va-path="0">hi</div>',
    frame: { html: {}, body: {}, ancestors: [] },
    css: [],
    viewport: VIEWPORT,
    inherited: {},
    fonts: [],
    diagnostics: [],
    ...overrides,
  };
}

describe('assembling a page from a document', () => {
  it('puts the inherited floor where it loses to the subject and to every rule on the root', () => {
    const page = assemble(
      documentOf({
        inherited: { 'font-size': '13px', '--brand': '#f00' },
        css: ['html{line-height:1.5}', '[data-va-path="0"]{font-size:20px}'],
      }),
    );

    const root = page.indexOf('@layer{html,body{margin:0;padding:0}:root{');
    const rules = page.indexOf('[data-va-path="0"]{font-size:20px}');
    expect(root).toBeGreaterThan(-1);
    // Order is the content of this assertion. The floor reaches the subject only
    // by inheritance, and inheritance loses to any declaration on the element —
    // so the subject's own 20px wins whatever the floor says.
    expect(root).toBeLessThan(rules);
    // And in a layer of its own, ahead of the document's rules, so it is the
    // lowest layer: the floor holds computed values, and `html{line-height:1.5}`
    // must keep its number rather than lose to the floor's `24px`, layered or not.
    expect(root).toBeLessThan(page.indexOf('html{line-height:1.5}'));
    expect(page).toContain('--brand:#f00');
  });

  it('rebuilds the ancestor chain a descendant selector needs', () => {
    const page = assemble(
      documentOf({
        frame: {
          html: { class: 'dark' },
          body: {},
          ancestors: [{ tag: 'div', attributes: { class: 'app' } }],
        },
        css: ['html.dark .app .item{color:#0f0}'],
      }),
    );

    expect(page).toContain('<html class="dark">');
    expect(page).toContain('<div class="app">');
    expect(page).toContain('</div></body>');
  });

  it('reproduces the container width a percentage resolves against', () => {
    // A subject declaring `width: 100%` is one size in a 1024px page and another
    // inside a 600px panel, and nothing else in the document says which it was.
    const page = assemble(
      documentOf({
        frame: {
          html: {},
          body: {},
          ancestors: [{ tag: 'aside', attributes: {} }],
          containerWidth: 600,
        },
      }),
    );

    expect(page).toContain('<aside style="width:600px !important">');
    expect(page).toContain('<body>');
  });

  it('puts the container width on the body when the body is the parent', () => {
    // Inline and important, so no page rule on the body, as Storybook's padded
    // layout writes one, overrides it.
    const page = assemble(
      documentOf({
        frame: { html: {}, body: { class: 'sb-main-padded' }, ancestors: [], containerWidth: 343 },
      }),
    );

    expect(page).toContain('<body class="sb-main-padded" style="width:343px !important">');
    expect(page).not.toMatch(/body\{[^}]*width/);
  });

  it('keeps a container width alongside a style the ancestor already had', () => {
    const page = assemble(
      documentOf({
        frame: {
          html: {},
          body: {},
          ancestors: [{ tag: 'div', attributes: { style: 'padding:8px' } }],
          containerWidth: 300,
        },
      }),
    );

    expect(page).toContain('style="padding:8px;width:300px !important"');
  });

  it('does not reproduce the browser default page margin', () => {
    // The subject's position on the page is not what is being compared, and an
    // 8px body margin offsets the clip box while changing nothing else.
    expect(assemble(documentOf())).toContain('html,body{margin:0;padding:0}');
  });

  it('escapes attribute values rather than emitting them raw', () => {
    const page = assemble(
      documentOf({ frame: { html: {}, body: { 'data-x': 'a"b<c&d' }, ancestors: [] } }),
    );

    expect(page).toContain('data-x="a&quot;b&lt;c&amp;d"');
  });
});
