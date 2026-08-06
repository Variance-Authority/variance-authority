// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { documentDigest, type Viewport } from '@variance-authority/core';
import { acquireDocument, PATH_ATTRIBUTE } from './document.js';

/**
 * Acquisition, under jsdom — which is the interesting host, not the convenient
 * one.
 *
 * jsdom cannot rasterize anything. If a document acquired there is a faithful
 * description of what to paint, then the deciding tier does not need a browser
 * and the expensive tier does not need to be on the same machine, which is the
 * whole of ADR-0002's sub-renderer split and the whole of the answer to paying
 * for a container everywhere.
 */

const VIEWPORT: Viewport = { width: 1024, height: 768, deviceScaleFactor: 1, colorScheme: 'light' };

function styleSheet(css: string): void {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}

function mount(html: string): Element {
  document.body.innerHTML = html;
  return document.querySelector('#subject')!;
}

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('class');
});

describe('acquiring a render document', () => {
  it('ships only the rules that touch the subject', () => {
    // The transport claim. A subject carrying a design system, a preview reset,
    // and a CSS-in-JS tag that has been accreting since page load is not worth
    // sending anywhere if what gets sent is all of it.
    styleSheet(
      Array.from({ length: 200 }, (_, index) => `.unrelated-${index}{color:#f0f}`).join('\n') +
        '\n#subject .item{color:#123456}',
    );
    const subject = mount('<div id="subject"><p class="item">hello</p></div>');

    const acquired = acquireDocument(subject, { subject: { id: 's', kind: 'fixture' }, viewport: VIEWPORT });

    // Serialized by the host's CSSOM, not by us — jsdom writes `rgb(18, 52, 86)`
    // where the author wrote `#123456`. Deliberately not canonicalized: this
    // phase must not become a second, invisible normalizer (ADR-0001). The cost
    // is real and stated in `documentDigest` — two engines can address the same
    // page differently, so a render cache is per-acquiring-engine.
    expect(acquired.css.join('\n')).toContain('rgb(18, 52, 86)');
    expect(acquired.css.join('\n')).not.toContain('unrelated');
  });

  it('carries design tokens declared on `:root`, which pruning correctly removes', () => {
    // The hole that makes the shipped stylesheet paint a colourless design
    // system: tokens live on `:root`, `:root` is outside every subject, so the
    // rule that defines them is dropped — correctly — and `var(--brand)` then
    // resolves to nothing on the far side of the hop.
    styleSheet(':root{--brand:#ff0000}\n#subject .item{color:var(--brand)}');
    const subject = mount('<div id="subject"><p class="item">hello</p></div>');

    const acquired = acquireDocument(subject, { subject: { id: 's', kind: 'fixture' }, viewport: VIEWPORT });

    expect(acquired.inherited['--brand']).toBe('#ff0000');
  });

  it('reproduces the ancestor chain a descendant selector needs', () => {
    styleSheet('.app .item{color:#00ff00}');
    document.documentElement.setAttribute('class', 'dark');
    const subject = mount('<div class="app"><div id="subject"><p class="item">x</p></div></div>');

    const acquired = acquireDocument(subject, { subject: { id: 's', kind: 'fixture' }, viewport: VIEWPORT });

    expect(acquired.frame.ancestors.map((a) => a.attributes['class'])).toEqual(['app']);
    expect(acquired.frame.html['class']).toBe('dark');
    expect(acquired.diagnostics.map((d) => d.code)).not.toContain('frame-incomplete');
  });

  it('reports a rule that stops matching once the frame is rebuilt', () => {
    // The defect this phase can produce silently. A rule kept because an
    // ancestor matched, rendered without that ancestor, is styling that vanishes
    // from the image — and looks exactly like a regression in a component nobody
    // touched. Detected here rather than discovered in a diff.
    styleSheet('body > section .item{color:#0000ff}');
    document.body.innerHTML = '<section><div id="subject"><p class="item">x</p></div></section>';
    const subject = document.querySelector('#subject')!;

    // Acquire the *inner* node so the frame has to reproduce `section`, then
    // break the reproduction by acquiring a detached copy of the subtree.
    const detached = subject.cloneNode(true) as Element;
    document.body.appendChild(detached);
    detached.setAttribute('id', 'subject2');

    const acquired = acquireDocument(detached, {
      subject: { id: 's', kind: 'fixture' },
      viewport: VIEWPORT,
    });

    // The rule needs `body > section`, which the detached copy does not have —
    // so it is not applicable and is not shipped. What matters is that nothing
    // claims otherwise.
    expect(acquired.css.join('\n')).not.toContain('#0000ff');
  });

  it('leaves the live DOM exactly as it found it', () => {
    // The path attribute is stamped on the real tree, because a clone has no
    // ancestors and `matches()` would then answer a different question. Anything
    // stamped has to come back off, or the next capture of this subject records
    // an attribute this phase invented.
    styleSheet('#subject{color:#111}');
    const subject = mount('<div id="subject"><p>x</p></div>');
    const before = subject.outerHTML;

    acquireDocument(subject, { subject: { id: 's', kind: 'fixture' }, viewport: VIEWPORT });

    expect(subject.outerHTML).toBe(before);
    expect(subject.hasAttribute(PATH_ATTRIBUTE)).toBe(false);
  });

  it('addresses a document by what it paints, not by where it came from', () => {
    styleSheet('#subject{color:#111}');

    const first = acquireDocument(mount('<div id="subject">x</div>'), {
      subject: { id: 'story:a', kind: 'story' },
      viewport: VIEWPORT,
    });
    const second = acquireDocument(mount('<div id="subject">x</div>'), {
      // A different subject id — a rename, a file move, a rebase. Content
      // addressing means none of that costs a re-render (Principle 4).
      subject: { id: 'story:b', kind: 'story' },
      viewport: VIEWPORT,
    });

    expect(documentDigest(first)).toBe(documentDigest(second));
  });

  it('changes address when the style that paints it changes', () => {
    styleSheet('#subject{color:#111}');
    const before = acquireDocument(mount('<div id="subject">x</div>'), {
      subject: { id: 's', kind: 'fixture' },
      viewport: VIEWPORT,
    });

    document.head.innerHTML = '';
    styleSheet('#subject{color:#222}');
    const after = acquireDocument(mount('<div id="subject">x</div>'), {
      subject: { id: 's', kind: 'fixture' },
      viewport: VIEWPORT,
    });

    expect(documentDigest(after)).not.toBe(documentDigest(before));
  });

  it('says so when it was given no font identities', () => {
    const subject = mount('<div id="subject">x</div>');
    const acquired = acquireDocument(subject, {
      subject: { id: 's', kind: 'fixture' },
      viewport: VIEWPORT,
    });

    expect(acquired.diagnostics.map((d) => d.code)).toContain('unverified-fonts');
  });
});

/**
 * The digest is a function of the tree, and of nothing about the run that read it.
 *
 * `outerHTML` writes attributes in the order the element happens to hold them,
 * so anything that changes *when* an attribute was set changes the digest of an
 * identical page. That is not a cosmetic property: `settle` skips a render when
 * this run's document digest equals the digest the baseline was painted from, so
 * a digest that drifts with collection history silently switches the cheap tier
 * off and reports nothing at all.
 *
 * Measured on `cases/storybook-case` before this held: a story collected on a
 * fresh mount serialized `<button type data-va-path style>` and the same story
 * collected again serialized `<button type style data-va-path>` — same tree,
 * same pixels, two digests.
 */
describe('a document acquired twice describes the same page twice', () => {
  it('puts the stamp last however the element already held it', () => {
    // The stamp survives from a previous acquisition only if something went
    // wrong, but *position* survives routinely: `setAttribute` on an attribute
    // that is already present updates it in place rather than appending. So the
    // order is decided by whichever acquisition first created it.
    const subject = mount('<div id="subject"><p>hello</p></div>');
    const paragraph = subject.querySelector('p')!;
    paragraph.setAttribute(PATH_ATTRIBUTE, 'stale');
    paragraph.setAttribute('class', 'item');

    const acquired = acquireDocument(subject, {
      subject: { id: 's', kind: 'fixture' },
      viewport: VIEWPORT,
    });

    expect(acquired.html).toContain(`<p class="item" ${PATH_ATTRIBUTE}="0/0">`);
  });

  it('produces one digest for two readings that differ only in when a stamp landed', () => {
    const first = mount('<div id="subject"><p class="item">hello</p></div>');
    const before = acquireDocument(first, {
      subject: { id: 's', kind: 'fixture' },
      viewport: VIEWPORT,
    });

    // The same tree, reached the other way round: the stamp is already there and
    // the page's own attribute is written after it. Nothing about what is painted
    // has changed, so nothing about the digest may.
    const second = mount('<div id="subject"><p>hello</p></div>');
    const paragraph = second.querySelector('p')!;
    paragraph.setAttribute(PATH_ATTRIBUTE, '0/0');
    paragraph.setAttribute('class', 'item');

    const after = acquireDocument(second, {
      subject: { id: 's', kind: 'fixture' },
      viewport: VIEWPORT,
    });

    expect(documentDigest(after)).toBe(documentDigest(before));
  });
});
