// @vitest-environment jsdom
//
// The commit record is read off React internals, so the claim worth pinning is
// what happens when React changes them: a root whose state no longer looks the
// way this module expects must read as not committed, and be refused, rather
// than read as committed and let the capture through mid-hydration.

import { createElement as h, use } from 'react';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { containerFiber } from './fiber.js';
import { rootCommitted } from './root-state.js';

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
});
