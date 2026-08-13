// @vitest-environment jsdom
//
// Real React, real promises, real fibers — for the reason `provenance.test.ts`
// gives. A mocked `memoizedState` would assert only that this file agrees with
// itself, and the entire claim of the module is that it agrees with React.

import { Suspense, act, createElement as h, use } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  awaitSuspense,
  pendingSuspense,
  suspenseBoundaries,
  suspenseBoundariesIn,
  suspenseRefusal,
} from './index.js';

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

/**
 * Run a body with React's act environment switched off.
 *
 * `awaitSuspense` observes a page nobody is driving — that is the entire point
 * of it — so the commit that resolves a boundary lands outside `act`, which is
 * exactly what React's act environment exists to complain about. Turning the
 * flag off for the duration says *this update is deliberately unmanaged* rather
 * than drowning the run in warnings about the thing under test.
 */
async function unmanaged<T>(body: () => Promise<T>): Promise<T> {
  const flags = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  flags.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    return await body();
  } finally {
    flags.IS_REACT_ACT_ENVIRONMENT = true;
  }
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

  it('reads a boundary under a node that is the root container itself', async () => {
    const data = deferred();

    await render(
      h(Suspense, { fallback: h('p', null, 'loading') }, h(Late, { promise: data.promise })),
    );

    // `createRoot(container)` writes `__reactContainer$…`, never `__reactFiber$…`
    // — so a read scoped to the element a run was told is the subject found no
    // fiber and reported a clean page. Which is precisely the arrangement every
    // Storybook run is in: `#storybook-root` is the container.
    expect(pendingSuspense(container)).toHaveLength(1);
    expect(pendingSuspense(container)[0]?.state).toBe('pending');
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

describe('waiting for a subject to arrive', () => {
  it('waits for a boundary that settles late, and returns settled', async () => {
    const data = deferred();

    function Panel() {
      return h(
        Suspense,
        { fallback: h('p', null, 'loading') },
        h(Late, { promise: data.promise }),
      );
    }

    await render(h('div', { 'data-t': 'page' }, h(Panel, null)));
    expect(find('page').textContent).toBe('loading');

    const settlement = await unmanaged(async () => {
      setTimeout(() => data.resolve(), 30);
      return awaitSuspense(find('page'), { timeoutMs: 2_000, pollMs: 5 });
    });

    expect(settlement.outcome).toBe('settled');
    expect(settlement.boundaries).toBe(1);
    expect(settlement.pending).toEqual([]);
    // The assertion that makes this worth doing at all: the DOM the caller is
    // about to read is the content, not the fallback that was there when it asked.
    expect(find('page').textContent).toBe('arrived');
  });

  it('gives up on a boundary that never resolves, and names it', async () => {
    // The never-resolving case, which is not slowness: no promise here is ever
    // settled, so waiting longer buys nothing and the wait has to end in a fact.
    const stuck = deferred();

    function Panel() {
      return h(
        Suspense,
        { fallback: h('p', null, 'loading') },
        h(Late, { promise: stuck.promise }),
      );
    }
    function Page() {
      return h('div', { 'data-t': 'page' }, h(Panel, null));
    }

    await render(h(Page, null));

    const settlement = await unmanaged(() =>
      awaitSuspense(find('page'), { timeoutMs: 60, pollMs: 5 }),
    );

    expect(settlement.outcome).toBe('pending');
    expect(settlement.waitedMs).toBeGreaterThanOrEqual(50);
    expect(settlement.pending).toHaveLength(1);
    expect(settlement.pending[0]?.owners).toEqual(['Panel', 'Page']);
    expect(settlement.pending[0]?.createdBy).toBe('Panel');

    // And the sentence a run prints, built from that: a component, not a
    // threshold. This is the whole difference from "timed out after 5000ms".
    const because = suspenseRefusal(settlement, { subjectId: 'story:panel--stuck' });
    expect(because).toContain('story:panel--stuck');
    expect(because).toContain('written by Panel');
    expect(because).toContain('flake source');
  });

  it('costs nothing on a subject with no boundary in it', async () => {
    await render(h('div', { 'data-t': 'page' }, h('span', null, 'static')));

    // Ten confirmations asked for, none paid: there is no boundary to have a
    // waterfall behind, and a suite of three hundred ordinary subjects must not
    // buy a frame each to be told so.
    const settlement = await unmanaged(() =>
      awaitSuspense(find('page'), { pollMs: 20, confirmations: 10 }),
    );

    expect(settlement.outcome).toBe('settled');
    expect(settlement.boundaries).toBe(0);
    expect(settlement.waitedMs).toBeLessThan(20);
  });

  it('confirms a clean read before believing it, when boundaries exist', async () => {
    const data = deferred();

    function Page() {
      return h(
        'div',
        { 'data-t': 'page' },
        h(Suspense, { fallback: h('p', null, 'loading') }, h(Late, { promise: data.promise })),
      );
    }

    await render(h(Page, null));
    await act(async () => {
      data.resolve();
      await data.promise;
    });

    // Resolved on the first read, and it still looks twice more. A boundary that
    // has just resolved is exactly when its children get to suspend on something
    // new, and the read that lands in that gap sees neither state.
    const settlement = await unmanaged(() =>
      awaitSuspense(find('page'), { pollMs: 10, confirmations: 3 }),
    );

    expect(settlement.outcome).toBe('settled');
    expect(settlement.boundaries).toBe(1);
    expect(settlement.waitedMs).toBeGreaterThanOrEqual(15);
  });

  it('reports a node React never rendered as unobserved, not as settled', async () => {
    const plain = document.createElement('div');
    document.body.appendChild(plain);

    const settlement = await awaitSuspense(plain, { timeoutMs: 500 });

    // ADR-0002 applied to a wait. "There is no React here" and "React finished"
    // are different facts, and a collector that received `settled` for the first
    // would report every non-React subject as having arrived successfully.
    expect(settlement.outcome).toBe('unobserved');
    expect(settlement.waitedMs).toBeLessThan(200);
    plain.remove();
  });

  it('reads once and waits for nothing when the timeout is zero', async () => {
    const stuck = deferred();

    function Page() {
      return h(
        'div',
        { 'data-t': 'page' },
        h(Suspense, { fallback: h('p', null, 'loading') }, h(Late, { promise: stuck.promise })),
      );
    }

    await render(h(Page, null));

    // What a deliberate loading-state capture asks for: the reading, none of the
    // waiting. It still comes back `pending`, because the declaration decides
    // what to do about that and this function does not.
    const settlement = await unmanaged(() => awaitSuspense(find('page'), { timeoutMs: 0 }));

    expect(settlement.outcome).toBe('pending');
    expect(settlement.waitedMs).toBeLessThan(50);
  });
});

describe('the decision a run forces', () => {
  const stuck = {
    outcome: 'pending' as const,
    waitedMs: 5_000,
    boundaries: 1,
    pending: [{ state: 'pending' as const, owners: ['Panel'], createdBy: 'Panel', depth: 0 }],
  };
  const arrived = { outcome: 'settled' as const, waitedMs: 12, boundaries: 1, pending: [] };

  it('refuses a subject that was still waiting', () => {
    expect(suspenseRefusal(stuck)).toContain('still waiting');
  });

  it('accepts the same subject when the loading state is what was wanted', () => {
    expect(suspenseRefusal(stuck, { declaredLoading: true })).toBeUndefined();
  });

  it('refuses a declaration whose subject now settles', () => {
    // The symmetry that keeps the escape hatch from becoming a suppression. A
    // declared loading capture that resolves records a component under a name
    // that promises a skeleton, and which one you get depends on the machine.
    const because = suspenseRefusal(arrived, { declaredLoading: true, subjectId: 'route/home' });
    expect(because).toContain('route/home');
    expect(because).toContain('had resolved');
  });

  it('refuses a declaration pointed at something with no boundary at all', () => {
    expect(
      suspenseRefusal(
        { outcome: 'settled', waitedMs: 0, boundaries: 0, pending: [] },
        { declaredLoading: true },
      ),
    ).toContain('no Suspense boundary at all');
  });

  it('says nothing about a subject nobody could read', () => {
    // A page with no React is not this mechanism's business, and refusing it
    // would make one framework's absence a build failure.
    expect(
      suspenseRefusal({ outcome: 'unobserved', waitedMs: 0, boundaries: 0, pending: [] }),
    ).toBeUndefined();
  });

  it('refuses a loading declaration on a subject nobody could read', () => {
    expect(
      suspenseRefusal(
        { outcome: 'unobserved', waitedMs: 0, boundaries: 0, pending: [] },
        { declaredLoading: true },
      ),
    ).toContain('no React tree was found');
  });

  it('says nothing about an ordinary subject that arrived', () => {
    expect(suspenseRefusal(arrived)).toBeUndefined();
  });
});
