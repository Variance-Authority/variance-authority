// @vitest-environment jsdom
//
// The claim under test is a negative one — that no serializer of HTML and CSS
// can separate these two cases — so every case below asserts the sameness of the
// document *before* asserting the difference in the fiber. An assertion that only
// showed the fiber difference would be a demonstration that fibers differ, which
// is not interesting; the finding is that they differ where nothing else does.

import { createElement as h, act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { markRender, remountedSince } from './identity.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

async function render(element: unknown): Promise<void> {
  await act(async () => {
    root.render(element as never);
  });
}

function at(marker: string): Element {
  const found = container.querySelector(`[data-t="${marker}"]`);
  if (!found) throw new Error(`no node marked ${marker}`);
  return found;
}

function subject(): Element {
  return at('subject');
}

/** A counter whose state is the thing a remount destroys. */
function Counter({ tick, marker }: { tick: number; marker: string }) {
  const [clicks, setClicks] = useState(0);
  return h(
    'button',
    { 'data-t': marker, onClick: () => setClicks(clicks + 1) },
    `${String(clicks)} of ${String(tick)}`,
  );
}

async function click(marker: string): Promise<void> {
  await act(async () => {
    at(marker).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('a component declared inside its parent', () => {
  it('is rebuilt on every parent render, and loses everything the user did', async () => {
    // The stable form. `Row` is one function, defined once.
    function Row({ tick }: { tick: number }) {
      return h(Counter, { tick, marker: 'stable' });
    }
    function StableHost({ tick }: { tick: number }) {
      return h('section', { 'data-t': 'subject' }, h(Row, { tick }));
    }

    await render(h(StableHost, { tick: 0 }));
    await click('stable');
    const stableMark = markRender(subject());
    await render(h(StableHost, { tick: 1 }));

    expect(remountedSince(subject(), stableMark)).toEqual([]);
    expect(at('stable').textContent).toBe('1 of 1');

    await act(async () => {
      root.unmount();
    });
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    // The defect. One character of difference in the source: `InnerRow` is
    // declared in the parent's body, so it is a *new function* on every render
    // and React cannot match it to the one before.
    function InlineHost({ tick }: { tick: number }) {
      function InnerRow({ at: t }: { at: number }) {
        return h(Counter, { tick: t, marker: 'inline' });
      }
      return h('section', { 'data-t': 'subject' }, h(InnerRow, { at: tick }));
    }

    await render(h(InlineHost, { tick: 0 }));
    await click('inline');
    const inlineMark = markRender(subject());
    await render(h(InlineHost, { tick: 1 }));

    // The consequence, measured. The user clicked once in both runs; only one
    // of the two still knows about it.
    expect(at('inline').textContent).toBe('0 of 1');

    const remounted = remountedSince(subject(), inlineMark);
    expect(remounted.map((entry) => entry.name)).toEqual(['InnerRow', 'Counter']);
    // No key anywhere near this, so nobody asked for the teardown. That is the
    // difference between a finding and a design decision, and it is the only
    // thing separating this from a deliberate `key`-driven remount.
    expect(remounted.every((entry) => entry.key === undefined)).toBe(true);
    expect(remounted[0]?.owners).toEqual(['InlineHost']);
  });
});

describe('what the document says about it', () => {
  it('says nothing: the two renders serialize identically', async () => {
    function Stable() {
      return h('span', { 'data-t': 'stable-out' }, 'row');
    }
    function StableHost() {
      return h('section', { 'data-t': 'subject' }, h(Stable, null));
    }
    function InlineHost() {
      function Inline() {
        return h('span', { 'data-t': 'stable-out' }, 'row');
      }
      return h('section', { 'data-t': 'subject' }, h(Inline, null));
    }

    await render(h(StableHost, null));
    const stableMark = markRender(subject());
    await render(h(StableHost, null));
    const stableHtml = subject().outerHTML;
    const stableFinding = remountedSince(subject(), stableMark);

    await render(h(InlineHost, null));
    const inlineMark = markRender(subject());
    await render(h(InlineHost, null));
    const inlineHtml = subject().outerHTML;
    const inlineFinding = remountedSince(subject(), inlineMark);

    // Byte-identical. There is no attribute, no role, no computed style and no
    // box that differs, so structure, semantics, text, style and geometry all
    // agree, and so would every pixel of a screenshot.
    expect(inlineHtml).toBe(stableHtml);

    // And the fiber does not agree.
    expect(stableFinding).toEqual([]);
    expect(inlineFinding.map((entry) => entry.name)).toEqual(['Inline']);
  });
});

describe('remounts somebody asked for', () => {
  it('reports the key rather than filtering the finding away', async () => {
    function Row({ id }: { id: string }) {
      return h('li', { 'data-t': `row-${id}` }, id);
    }
    function List({ id }: { id: string }) {
      return h('ul', { 'data-t': 'subject' }, h(Row, { key: id, id }));
    }

    await render(h(List, { id: 'a' }));
    const mark = markRender(subject());
    await render(h(List, { id: 'b' }));

    const remounted = remountedSince(subject(), mark);

    // A changed `key` is the documented way to ask React for a fresh instance,
    // and it produces exactly the same `alternate === null` as the accidental
    // kind. Deciding here that a keyed remount is uninteresting would hide the
    // case where somebody keyed by a value that changes more often than they
    // thought — so the key is reported and the reader decides.
    expect(remounted).toHaveLength(1);
    expect(remounted[0]?.name).toBe('Row');
    expect(remounted[0]?.key).toBe('b');
  });
});

describe('what is not a remount', () => {
  it('leaves out a component appearing for the first time', async () => {
    function Row({ id }: { id: string }) {
      return h('li', { 'data-t': `row-${id}` }, id);
    }
    function List({ ids }: { ids: readonly string[] }) {
      return h(
        'ul',
        { 'data-t': 'subject' },
        ids.map((id) => h(Row, { key: id, id })),
      );
    }

    await render(h(List, { ids: ['a'] }));
    const mark = markRender(subject());
    await render(h(List, { ids: ['a', 'b'] }));

    // `b` is new, not rebuilt. Reporting it would bury every real finding under
    // every list insertion on the page.
    expect(remountedSince(subject(), mark)).toEqual([]);
  });

  it('leaves out a page that has merely mounted', async () => {
    function Page() {
      return h('section', { 'data-t': 'subject' }, h('span', null, 'x'));
    }

    await render(h(Page, null));

    // After the first commit every fiber on the page has `alternate === null`,
    // correctly and uninterestingly. A mark taken against the mounted page is
    // what stops that reading the whole document as rebuilt — which is why
    // there is a mark at all.
    expect(remountedSince(subject(), markRender(subject()))).toEqual([]);
  });

  it('leaves out a subtree that bailed out and never committed', async () => {
    let bump!: () => void;
    function Sibling() {
      const [n, setN] = useState(0);
      bump = () => setN(n + 1);
      return h('span', { 'data-t': 'sibling' }, String(n));
    }
    function Quiet() {
      return h('span', { 'data-t': 'quiet' }, 'still');
    }
    function Page() {
      return h('section', { 'data-t': 'subject' }, h(Sibling, null), h(Quiet, null));
    }

    await render(h(Page, null));
    const mark = markRender(subject());
    await act(async () => {
      bump();
    });

    // `Quiet` bailed out, so it kept its fiber and never acquired an alternate —
    // `alternate === null` on a component that did nothing. Identity has to be
    // checked before shape, or every quiet component on the page reads as
    // rebuilt on the first state update anywhere near it.
    expect(at('sibling').textContent).toBe('1');
    expect(remountedSince(subject(), mark)).toEqual([]);
  });
});
