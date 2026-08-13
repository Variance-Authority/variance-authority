// @vitest-environment jsdom
//
// Real React, real promises, real fibers — for the reason `provenance.test.ts`
// gives. A mocked `memoizedState` would assert only that this file agrees with
// itself, and the entire claim of the module is that it agrees with React.

import { Suspense, act, createElement as h, use } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pendingSuspense, suspenseBoundaries, suspenseBoundariesIn } from './index.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

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

function find(marker: string): Element {
  const element = document.querySelector(`[data-t="${marker}"]`);
  if (!element) throw new Error(`no element marked ${marker}`);
  return element;
}

/** A promise the test resolves by hand, so "still waiting" is a state we hold. */
function deferred(): { promise: Promise<string>; resolve: () => void } {
  let settle!: (value: string) => void;
  const promise = new Promise<string>((resolveWith) => {
    settle = resolveWith;
  });
  return { promise, resolve: () => settle('arrived') };
}

function Late({ promise }: { promise: Promise<string> }) {
  return h('span', { 'data-t': 'late' }, use(promise));
}

describe('a boundary that is waiting', () => {
  it('is pending, and named by the components above it', async () => {
    const data = deferred();

    function Panel() {
      return h(
        Suspense,
        { fallback: h('p', null, 'loading') },
        h(Late, { promise: data.promise }),
      );
    }
    function Page() {
      return h('div', { 'data-t': 'page' }, h(Panel, null));
    }

    await render(h(Page, null));

    const boundaries = pendingSuspense(find('page'));
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0]?.state).toBe('pending');
    // Innermost first: the boundary sits inside `Panel`, which sits inside `Page`.
    expect(boundaries[0]?.owners).toEqual(['Panel', 'Page']);
    // Who wrote the `<Suspense>` — `Panel`, not the component that encloses it.
    expect(boundaries[0]?.createdBy).toBe('Panel');
    expect(boundaries[0]?.depth).toBe(0);
  });

  it('reads resolved once the promise settles, from the same walk', async () => {
    const data = deferred();

    function Page() {
      return h(
        'div',
        { 'data-t': 'page' },
        h(Suspense, { fallback: h('p', null, 'loading') }, h(Late, { promise: data.promise })),
      );
    }

    await render(h(Page, null));
    expect(pendingSuspense(find('page'))).toHaveLength(1);

    await act(async () => {
      data.resolve();
      await data.promise;
    });

    // The boundary is still there; what changed is its state — which is the
    // whole point of reporting a state rather than a count.
    expect(suspenseBoundariesIn(find('page'))).toHaveLength(1);
    expect(suspenseBoundariesIn(find('page'))[0]?.state).toBe('resolved');
    expect(pendingSuspense(find('page'))).toEqual([]);
    expect(find('late').textContent).toBe('arrived');
  });

  it('counts how many boundaries enclose a nested one', async () => {
    const data = deferred();

    function Page() {
      return h(
        'div',
        { 'data-t': 'page' },
        h(
          Suspense,
          { fallback: h('p', null, 'outer') },
          h(Suspense, { fallback: h('p', null, 'inner') }, h(Late, { promise: data.promise })),
        ),
      );
    }

    await render(h(Page, null));

    const boundaries = suspenseBoundariesIn(find('page'));
    expect(boundaries.map((boundary) => boundary.depth)).toEqual([0, 1]);
    // The inner one is what suspended; the outer never fell back, and reporting
    // both as pending would send a reader to the wrong `<Suspense>`.
    expect(boundaries.map((boundary) => boundary.state)).toEqual(['resolved', 'pending']);
  });

  it('carries the key when the author gave one', async () => {
    const data = deferred();

    function Page() {
      return h(
        'div',
        { 'data-t': 'page' },
        h(
          Suspense,
          { key: 'panel-2', fallback: h('p', null, 'loading') },
          h(Late, { promise: data.promise }),
        ),
      );
    }

    await render(h(Page, null));
    expect(pendingSuspense(find('page'))[0]?.key).toBe('panel-2');
  });
});

describe('what the walk is scoped to', () => {
  it('excludes a boundary that is not inside the subject', async () => {
    const data = deferred();

    function Page() {
      return h(
        'div',
        null,
        h('section', { 'data-t': 'subject' }, h('span', null, 'settled')),
        h(
          'aside',
          null,
          h(Suspense, { fallback: h('p', null, 'loading') }, h(Late, { promise: data.promise })),
        ),
      );
    }

    await render(h(Page, null));

    // The page is not finished arriving, but this subject is — and a run that
    // reported the aside's spinner against `section` would blame a component
    // that has nothing to do with it.
    expect(pendingSuspense(find('subject'))).toEqual([]);
    expect(suspenseBoundaries(document.body).filter((b) => b.state === 'pending')).toHaveLength(1);
  });

  it('is empty for a node React never rendered', () => {
    const plain = document.createElement('div');
    document.body.appendChild(plain);
    expect(suspenseBoundariesIn(plain)).toEqual([]);
    plain.remove();
  });

  it('finds roots structurally, with no hook installed', async () => {
    const data = deferred();

    await render(
      h(
        'div',
        null,
        h(Suspense, { fallback: h('p', null, 'loading') }, h(Late, { promise: data.promise })),
      ),
    );

    expect((globalThis as Record<string, unknown>)['__REACT_DEVTOOLS_GLOBAL_HOOK__']).toBeUndefined();
    expect(suspenseBoundaries(document.body).map((boundary) => boundary.state)).toEqual(['pending']);
  });
});
