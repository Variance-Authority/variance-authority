// @vitest-environment jsdom
//
// The commit record is read off React internals, so the claim worth pinning is
// what happens when React changes them: a root whose state no longer looks the
// way this module expects must read as not committed, and be refused, rather
// than read as committed and let the capture through mid-hydration.

import { createElement as h, Suspense, use } from 'react';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { containerFiber } from './fiber.js';
import { rootCommitted, rootHasWork } from './root-state.js';

const roots: Root[] = [];
const gates: Array<() => void> = [];

afterEach(async () => {
  for (const open of gates.splice(0)) open();
  await ticks();
  for (const root of roots.splice(0)) root.unmount();
  document.body.replaceChildren();
});

function ticks(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function Slow({ ready }: { readonly ready: Promise<void> }) {
  use(ready);
  return h('p', null, 'late');
}

/** A real `FiberRoot`, hydrating with a shell that holds until the test ends. */
async function hydratingRoot(): Promise<{ readonly current: Record<string, unknown> }> {
  const container = document.createElement('div');
  container.innerHTML = '<main><span>early</span><p>late</p></main>';
  document.body.appendChild(container);

  let open!: () => void;
  const ready = new Promise<void>((resolve) => {
    open = resolve;
  });
  gates.push(open);
  roots.push(hydrateRoot(container, h('main', null, h('span', null, 'early'), h(Slow, { ready }))));
  await ticks();

  const root = containerFiber(container)?.stateNode as { readonly current: Record<string, unknown> } | undefined;
  if (root === undefined) throw new Error('no FiberRoot on the container');
  return root;
}

/** The same root, with one field of its current `HostRoot`'s state renamed. */
function renamed(root: { readonly current: Record<string, unknown> }, from: string, to: string): object {
  const state = { ...(root.current['memoizedState'] as Record<string, unknown>) };
  state[to] = state[from];
  delete state[from];
  return { ...root, current: { ...root.current, memoizedState: state } };
}

describe('reading whether a root has committed, when React changes the fields', () => {
  it('reads a hydrating root as not committed', async () => {
    expect(rootCommitted(await hydratingRoot())).toBe(false);
  });

  it('reads a hydrating root as not committed when `isDehydrated` is renamed', async () => {
    expect(rootCommitted(renamed(await hydratingRoot(), 'isDehydrated', 'dehydrated'))).toBe(false);
  });

  it('reads a root as not committed when `element` is renamed', async () => {
    expect(rootCommitted(renamed(await hydratingRoot(), 'element', 'children'))).toBe(false);
  });

  /** An element that renders nothing leaves no `child`, and the root has still committed. */
  it('reads a root that committed `false` as committed', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    root.render(false);
    await ticks();

    expect(rootCommitted(containerFiber(container)!.stateNode as object)).toBe(true);
  });

  it('reads a committed root as not committed when `current` is renamed', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    root.render(h('p', null, 'done'));
    await ticks();

    const fiberRoot = containerFiber(container)!.stateNode as Record<string, unknown>;
    expect(rootCommitted(fiberRoot)).toBe(true);

    const { current, ...rest } = fiberRoot;
    expect(rootCommitted({ ...rest, currentFiber: current })).toBe(false);
  });
});

describe('reading whether React has work on a root', () => {
  /**
   * A boundary whose content arrives soon after its fallback committed is
   * rendered at once and committed later: React holds the commit on a timer
   * of its own so the fallback does not flash. Its lanes read suspended and
   * not pinged meanwhile, and the commit is still React's to make.
   */
  it('counts a commit React has held back as work', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    let open!: () => void;
    const ready = new Promise<void>((resolve) => {
      open = resolve;
    });
    const root = createRoot(container);
    roots.push(root);
    root.render(h(Suspense, { fallback: h('p', null, 'wait') }, h(Slow, { ready })));
    await ticks(20);
    expect(container.textContent).toBe('wait');

    open();
    await ticks(20);
    const fiberRoot = containerFiber(container)!.stateNode as object;
    expect(container.textContent).toBe('wait');
    expect(rootHasWork(fiberRoot)).toBe(true);

    await ticks(400);
    expect(container.textContent).toBe('late');
    expect(rootHasWork(fiberRoot)).toBe(false);
  });

  it('counts a lane React can render, and a suspended one a settled promise pinged', () => {
    expect(rootHasWork({ pendingLanes: 0b10, suspendedLanes: 0, pingedLanes: 0 })).toBe(true);
    expect(rootHasWork({ pendingLanes: 0b10, suspendedLanes: 0b10, pingedLanes: 0b10 })).toBe(true);
    expect(rootHasWork({ pendingLanes: 0, suspendedLanes: 0, pingedLanes: 0 })).toBe(false);
  });

  /** A commit waiting on a stylesheet or an image holds a way to cancel it. */
  it('counts a commit waiting on its resources as work', () => {
    const lanes = { pendingLanes: 0b100, suspendedLanes: 0b100, pingedLanes: 0, timeoutHandle: -1 };
    expect(rootHasWork(lanes)).toBe(false);
    expect(rootHasWork({ ...lanes, cancelPendingCommit: () => {} })).toBe(true);
  });
});
