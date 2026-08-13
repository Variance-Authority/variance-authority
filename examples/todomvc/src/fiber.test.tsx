// @vitest-environment jsdom
import { act, createContext, createElement as h, memo, useContext, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import {
  componentInstances,
  normalize,
  type ComponentInstance,
  type Viewport,
} from '@variance-authority/core';
import { collect } from '@variance-authority/dom';
import {
  markRender,
  portalContentOf,
  provenanceOf,
  remountedSince,
  wiringOf,
} from '@variance-authority/react';
import { DS_CSS } from './ds/styles.js';
import { TOKENS_CSS } from './tokens/foundation.js';

/**
 * The framework as a dimension, on a real collection.
 *
 * Every other reading in this suite ends at the document. `structure` reads the
 * tree, `semantics` the roles and names, `text` the prose, `style` the winning
 * declarations, `geometry` the boxes. Five bands, and all five are downstream of
 * a render that has already happened — which means all five are blind in exactly
 * the same place, and it is not a small place.
 *
 * Two components can produce a byte-identical document while differing in how
 * they are attached to React: one memoised and one not, one subscribed to a
 * theme context and one not, one keyed by identity and one by index, one that
 * survives its parent's re-render and one that is destroyed and rebuilt by it.
 * Those differences decide what happens next — what re-renders, what reorders
 * correctly, what keeps the user's typing. A suite that cannot see them is not
 * missing an edge case; it is recording two different components as the same
 * component and calling it a pass.
 *
 * This file collects two documents that agree on all five content bands, and
 * shows the fiber disagreeing about them.
 *
 * ## The two halves, and the rule between them
 *
 * | | reads | lives in | shape |
 * |---|---|---|---|
 * | `wiringOf` | hooks, wrappers, contexts, keys | a hashed band | a property of the *revision* |
 * | `remountedSince` | `alternate === null` after a commit | a finding | a property of the *reading* |
 *
 * The rule that sorts them is the band contract, and it is checkable: read the
 * same page twice without changing anything, and if the value moved it is not a
 * band. Hook shape survives that. Whether an instance remounted cannot, by
 * construction — so it sits beside `pendingSuspense` as something a run reports,
 * not something a baseline stores.
 */

const VIEWPORT: Viewport = { width: 1024, height: 768, deviceScaleFactor: 1, colorScheme: 'light' };

type ActEnvironment = { IS_REACT_ACT_ENVIRONMENT?: boolean };

function sheets(): void {
  document.head.innerHTML = '';
  for (const [name, css] of [
    ['tokens', TOKENS_CSS],
    ['design-system', DS_CSS],
  ] as const) {
    const sheet = document.createElement('style');
    sheet.setAttribute('data-fiber-sheet', name);
    sheet.textContent = css;
    document.head.appendChild(sheet);
  }
}

/** The collection a run performs, with the framework adapter fully wired in. */
function read(subject: Element): readonly ComponentInstance[] {
  return componentInstances(
    normalize(
      collect(subject, {
        subject: { id: 'fiber', kind: 'story' },
        viewport: VIEWPORT,
        engine: 'jsdom@fiber',
        fonts: ['system/400/normal/fiber'],
        provenanceOf,
        // The one new line. Everything below follows from it.
        wiringOf,
        portalsOf: portalContentOf,
      }),
    ),
  );
}

function instance(instances: readonly ComponentInstance[], component: string): ComponentInstance {
  const found = instances.find((candidate) => candidate.component === component);
  if (!found) throw new Error(`no boundary for ${component}`);
  return found;
}

function mount(element: unknown): { subject: Element; rerender: (next: unknown) => void; stop: () => void } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(element as never));

  const subject = (): Element => {
    const found = container.querySelector('[data-t="subject"]');
    if (!found) throw new Error('no subject');
    return found;
  };

  return {
    get subject() {
      return subject();
    },
    rerender: (next) => act(() => root.render(next as never)),
    stop: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

const Theme = createContext('light');
Theme.displayName = 'ThemeContext';

describe('two components that render the same document', () => {
  it('agree on every content band and disagree on wiring', () => {
    (globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;
    sheets();

    // Memoised, stateful, and subscribed to a theme.
    const Wired = memo(function Row() {
      const [label] = useState('Buy milk');
      useContext(Theme);
      return h('li', { className: 'va-text' }, label);
    });

    // The same output, and nothing else the same.
    function Bare() {
      return h('li', { className: 'va-text' }, 'Buy milk');
    }

    const wired = mount(
      h(Theme.Provider, { value: 'dark' }, h('ul', { 'data-t': 'subject' }, h(Wired, null))),
    );
    const wiredRead = read(wired.subject);
    const wiredHtml = wired.subject.innerHTML;
    const rowWiredWiring = wiringOf(wired.subject.firstElementChild as Element);
    wired.stop();

    const bare = mount(h('ul', { 'data-t': 'subject' }, h(Bare, null)));
    const bareRead = read(bare.subject);
    const bareHtml = bare.subject.innerHTML;
    const rowBareWiring = wiringOf(bare.subject.firstElementChild as Element);
    bare.stop();

    const rowWired = instance(wiredRead, 'Row');
    const rowBare = instance(bareRead, 'Bare');

    // 1. The documents are byte-identical, so every content band agrees. This is
    //    the whole claim: there is nothing here for a serializer of HTML and CSS
    //    to find, and nothing for a pixel differ either.
    expect(bareHtml).toBe(wiredHtml);
    expect(rowBare.rendering).toBe(rowWired.rendering);
    expect(rowBare.structure).toBe(rowWired.structure);
    expect(rowBare.semantics).toBe(rowWired.semantics);
    expect(rowBare.text).toBe(rowWired.text);
    expect(rowBare.style).toBe(rowWired.style);

    // 2. And the sixth band does not. One of these components will skip a
    //    parent's re-render and re-render on a theme switch; the other will do
    //    the exact opposite. That is a fact about the revision, it is stable
    //    across readings, and until now it was not recorded anywhere.
    expect(rowWired.wiring).toBeDefined();
    expect(rowBare.wiring).toBeDefined();
    expect(rowBare.wiring).not.toBe(rowWired.wiring);

    // 3. And `Bare` is not absent from the band — it reports an empty wiring,
    //    which is the true answer for a component that declares nothing. Absent
    //    is reserved for a node this adapter could not read, so that a page with
    //    no framework never compares equal to a plain component (ADR-0002).
    expect(rowBareWiring).toEqual({});
    expect(rowWiredWiring?.hooks).toEqual(['useState', 'useContext']);
    expect(rowWiredWiring?.wrappers).toEqual(['memo']);
    expect(rowWiredWiring?.contexts).toEqual(['ThemeContext']);
  });

  it('reports the band as absent, not empty, when nothing supplied wiring', () => {
    sheets();
    const page = mount(h('ul', { 'data-t': 'subject' }, h('li', { className: 'va-text' }, 'x')));

    // Collected without `wiringOf`: the same page, read by a run with no
    // framework adapter. The band is absent rather than a digest of nulls,
    // because a page nobody could read must not compare equal to a page that
    // was read and found to have no wiring (ADR-0002).
    const blind = componentInstances(
      normalize(
        collect(page.subject, {
          subject: { id: 'fiber', kind: 'story' },
          viewport: VIEWPORT,
          engine: 'jsdom@fiber',
          fonts: ['system/400/normal/fiber'],
          provenanceOf,
          portalsOf: portalContentOf,
        }),
      ),
    );

    for (const found of blind) expect(found.wiring).toBeUndefined();
    page.stop();
  });
});

describe('one component read twice', () => {
  it('holds its wiring while its document moves, which is what makes it a band', () => {
    sheets();

    function Counter({ tick }: { tick: number }) {
      const [clicks] = useState(0);
      return h('span', { 'data-t': 'subject', className: 'va-text' }, `${String(clicks)}/${String(tick)}`);
    }

    const page = mount(h(Counter, { tick: 0 }));
    const before = instance(read(page.subject), 'Counter');

    page.rerender(h(Counter, { tick: 1 }));
    const after = instance(read(page.subject), 'Counter');

    // The text moved, so `text` and `rendering` moved with it. The wiring did
    // not, because nothing about the component changed — only what it was
    // holding. A band that moved here would be a flake generator with a band's
    // name on it, which is exactly why `Wiring` carries hook *names* and never
    // hook values.
    expect(after.text).not.toBe(before.text);
    expect(after.rendering).not.toBe(before.rendering);
    expect(after.wiring).toBe(before.wiring);

    page.stop();
  });
});

describe('the thing no band can carry', () => {
  it('separates a rebuilt component from an updated one, where the six bands cannot', () => {
    sheets();

    // Two hosts that differ in one respect: where the child is declared.
    function Child({ tick }: { tick: number }) {
      const [clicks, setClicks] = useState(0);
      return h(
        'button',
        { 'data-t': 'counter', className: 'va-text', onClick: () => setClicks(clicks + 1) },
        `${String(clicks)}/${String(tick)}`,
      );
    }

    function StableHost({ tick }: { tick: number }) {
      return h('section', { 'data-t': 'subject' }, h(Child, { tick }));
    }

    function InlineHost({ tick }: { tick: number }) {
      // Declared in the body, so it is a new function on every render and React
      // cannot match it to the one before. One line, and it is the difference
      // between a component that keeps the user's work and one that throws it
      // away on every parent render.
      function Inline({ tick: inner }: { tick: number }) {
        const [clicks, setClicks] = useState(0);
        return h(
          'button',
          { 'data-t': 'counter', className: 'va-text', onClick: () => setClicks(clicks + 1) },
          `${String(clicks)}/${String(inner)}`,
        );
      }
      return h('section', { 'data-t': 'subject' }, h(Inline, { tick }));
    }

    const click = (page: { subject: Element }): void => {
      act(() => {
        page.subject
          .querySelector('[data-t="counter"]')
          ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
    };

    const stable = mount(h(StableHost, { tick: 0 }));
    click(stable);
    const stableMark = markRender(stable.subject);
    stable.rerender(h(StableHost, { tick: 1 }));
    const stableFindings = remountedSince(stable.subject, stableMark);
    const stableHtml = stable.subject.outerHTML;
    stable.stop();

    const inline = mount(h(InlineHost, { tick: 0 }));
    click(inline);
    const inlineMark = markRender(inline.subject);
    inline.rerender(h(InlineHost, { tick: 1 }));
    const inlineFindings = remountedSince(inline.subject, inlineMark);
    const inlineHtml = inline.subject.outerHTML;

    // 1. The consequence, which is what the finding is *about*. The user clicked
    //    once on each page. One page still knows.
    expect(stableHtml).toContain('1/1');
    expect(inlineHtml).toContain('0/1');

    // 2. Now the same comparison with the click removed, so the documents match
    //    and the bands have nothing to go on. This is the case a real suite hits:
    //    nobody clicked, the page looks perfect, and the defect is still there.
    inline.stop();

    const quietStable = mount(h(StableHost, { tick: 0 }));
    const quietStableMark = markRender(quietStable.subject);
    quietStable.rerender(h(StableHost, { tick: 1 }));
    const quietStableRead = read(quietStable.subject);
    const quietStableHtml = quietStable.subject.outerHTML;
    const quietStableFindings = remountedSince(quietStable.subject, quietStableMark);
    quietStable.stop();

    const quietInline = mount(h(InlineHost, { tick: 0 }));
    const quietInlineMark = markRender(quietInline.subject);
    quietInline.rerender(h(InlineHost, { tick: 1 }));
    const quietInlineRead = read(quietInline.subject);
    const quietInlineHtml = quietInline.subject.outerHTML;
    const quietInlineFindings = remountedSince(quietInline.subject, quietInlineMark);
    quietInline.stop();

    // Byte-identical documents.
    expect(quietInlineHtml).toBe(quietStableHtml);

    // The boundary named differently — `Child` against `Inline` — but everything
    // measured about it is equal, including the new band. Wiring is a property
    // of a revision and both revisions declare one `useState`; it cannot and
    // must not say that one of these tears itself down.
    const childBoundary = instance(quietStableRead, 'Child');
    const inlineBoundary = instance(quietInlineRead, 'Inline');
    expect(inlineBoundary.rendering).toBe(childBoundary.rendering);
    expect(inlineBoundary.wiring).toBe(childBoundary.wiring);

    // And the finding, which is the only thing in this repository that separates
    // them. It is not a band, it is not in a baseline, and it names the outer
    // component — the cause — before the ones rebuilt along with it.
    expect(stableFindings).toEqual([]);
    expect(quietStableFindings).toEqual([]);
    expect(inlineFindings.map((entry) => entry.name)).toEqual(['Inline']);
    expect(quietInlineFindings.map((entry) => entry.name)).toEqual(['Inline']);
    expect(quietInlineFindings[0]?.owners).toEqual(['InlineHost']);
    // No key, so nobody asked for this. That is the difference between a defect
    // and a design decision, and it is the only thing that separates the two.
    expect(quietInlineFindings[0]?.key).toBeUndefined();
  });
});
