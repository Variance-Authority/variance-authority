// @vitest-environment jsdom
//
// Real React, for the reason `suspense.test.tsx` gives: a fake `memoizedState`
// would assert that this file agrees with itself, and the claim of the module
// is that it agrees with React about whether a root has committed.

import { createElement as h, use } from 'react';
import { createPortal } from 'react-dom';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { hasFiber } from './fiber.js';
import { awaitHydration } from './hydration.js';

function Header() {
  return h('span', null, 'early');
}

function Slow({ ready }: { readonly ready: Promise<void> }) {
  use(ready);
  return h('p', null, 'late');
}

function App({ ready }: { readonly ready: Promise<void> }) {
  return h('main', { id: 'app' }, h(Header), h(Slow, { ready }));
}

/** What `App` renders, as a server sends it. */
const MARKUP = '<main id="app"><span>early</span><p>late</p></main>';

/** A promise the test settles, so a shell suspends for exactly as long as it says. */
function gate(): { readonly ready: Promise<void>; open(): void } {
  let open!: () => void;
  const ready = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { ready, open };
}

const roots: Root[] = [];
const gates: Array<() => void> = [];

afterEach(async () => {
  // Opened and let finish before unmounting: an unmount is an update, and an
  // update to a root still hydrating makes React give up on the hydration.
  for (const open of gates.splice(0)) open();
  await ticks();
  for (const root of roots.splice(0)) root.unmount();
  document.body.replaceChildren();
});

/** Long enough for React's scheduler to start the render and stop in the shell. */
function ticks(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A server-rendered container, hydrated with a shell that holds until `open`. */
async function hydrating(): Promise<{ readonly container: HTMLElement; open(): void }> {
  const container = document.createElement('div');
  container.innerHTML = MARKUP;
  document.body.appendChild(container);

  const held = gate();
  gates.push(held.open);
  roots.push(hydrateRoot(container, h(App, { ready: held.ready })));
  await ticks();
  return { container, open: held.open };
}

function subjectOf(container: HTMLElement): Element {
  const main = container.querySelector('#app');
  if (main === null) throw new Error('no #app in the container');
  return main;
}

describe('waiting for React to hydrate the subject', () => {
  /**
   * The window the wait exists for. React renders `Header`, attaches a fiber to
   * its `<span>`, then stops in `Slow` with the root still dehydrated. From the
   * DOM this looks like a finished commit: a node carries a fiber and the count
   * holds still for as long as anybody watches. React's own record of the root
   * says the commit has not happened, and that record is the one read.
   */
  it('reads a shell that stopped mid-hydration as hydrating, not as hydrated', async () => {
    const page = await hydrating();
    const span = page.container.querySelector('span');
    const late = page.container.querySelector('p');

    // The window is real: part of the tree is attached and part is not.
    expect(span !== null && hasFiber(span)).toBe(true);
    expect(late !== null && hasFiber(late)).toBe(false);

    const settled = await awaitHydration(subjectOf(page.container), { timeoutMs: 80, pollMs: 4 });

    expect(settled).toMatchObject({ state: 'hydrating', roots: 1, pending: 1 });
    expect(settled.waitedMs).toBeGreaterThanOrEqual(80);
  });

  it('returns once React commits the hydration, however long the shell held', async () => {
    const page = await hydrating();
    setTimeout(page.open, 120);

    const settled = await awaitHydration(subjectOf(page.container), { timeoutMs: 5_000, pollMs: 4 });

    expect(settled).toMatchObject({ state: 'hydrated', roots: 1, pending: 0 });
    expect(settled.waitedMs).toBeGreaterThanOrEqual(100);
    expect(hasFiber(page.container.querySelector('p')!)).toBe(true);
  });

  it('returns on the first read of a subject already hydrated', async () => {
    const page = await hydrating();
    page.open();
    await ticks();

    const settled = await awaitHydration(subjectOf(page.container), { timeoutMs: 5_000 });

    expect(settled).toMatchObject({ state: 'hydrated', roots: 1, pending: 0 });
    expect(settled.waitedMs).toBeLessThan(50);
  });

  /**
   * A root created and not yet committed is the same unknown as a dehydrated
   * one: nothing it will render has a fiber yet. Found under the subject, which
   * is the other direction a root can sit in.
   */
  it('waits for a client root to commit its first render', async () => {
    const section = document.createElement('section');
    const container = document.createElement('div');
    section.appendChild(container);
    document.body.appendChild(section);

    const held = gate();
    gates.push(held.open);
    const root = createRoot(container);
    roots.push(root);
    root.render(h(App, { ready: held.ready }));
    await ticks();

    expect(await awaitHydration(section, { timeoutMs: 40, pollMs: 4 })).toMatchObject({
      state: 'hydrating',
      roots: 1,
      pending: 1,
    });

    held.open();
    expect(await awaitHydration(section, { timeoutMs: 5_000, pollMs: 4 })).toMatchObject({
      state: 'hydrated',
      roots: 1,
      pending: 0,
    });
  });

  /**
   * A subject portalled out of its root has no container above or below it.
   * The fiber on the node itself is what leads back to the root.
   */
  it('finds the root of a subject portalled out of it', async () => {
    const container = document.createElement('div');
    const outside = document.createElement('aside');
    document.body.append(container, outside);

    const root = createRoot(container);
    roots.push(root);
    root.render(h('div', null, createPortal(h('em', null, 'away'), outside)));
    await ticks();

    const settled = await awaitHydration(outside.querySelector('em')!, { timeoutMs: 1_000 });

    expect(settled).toMatchObject({ state: 'hydrated', roots: 1, pending: 0 });
  });

  /**
   * The answer that is not about timing. No root reached the subject, which is
   * either a page React does not render or one whose client had not run yet —
   * and the two are the same page at the moment of reading, so the answer does
   * not pretend to pick one.
   */
  it('answers unrooted when no React root reaches the subject', async () => {
    const plain = document.createElement('main');
    plain.innerHTML = '<p>static</p>';
    document.body.appendChild(plain);

    const settled = await awaitHydration(plain, { timeoutMs: 40, pollMs: 4 });

    expect(settled).toMatchObject({ state: 'unrooted', roots: 0, pending: 0 });
    expect(settled.waitedMs).toBeGreaterThanOrEqual(40);
  });

  it('reads once and waits for nothing at `timeoutMs: 0`', async () => {
    const page = await hydrating();

    const settled = await awaitHydration(subjectOf(page.container), { timeoutMs: 0 });

    expect(settled.state).toBe('hydrating');
    expect(settled.waitedMs).toBeLessThan(20);
  });
});
