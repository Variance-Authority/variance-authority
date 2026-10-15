// @vitest-environment jsdom
//
// Real React and a real commit tap, for the reasons `hydration.test.ts` gives:
// the tap is installed at module scope with `react-dom` imported underneath it.

import { createElement as h, use, useEffect, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { tapCommits } from './commits.js';
import { awaitHydration } from './hydration.js';

const tap = tapCommits();

const { createRoot, hydrateRoot } = await import('react-dom/client');

type Root = ReturnType<typeof createRoot>;

/** Renders the server's text, then replaces it once mounted on the client. */
function Flip({ ready }: { readonly ready: Promise<void> }) {
  use(ready);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return h('main', { id: 'app' }, h('p', null, mounted ? 'client' : 'early'));
}

/** Renders the server's text, and keeps it. */
function Still({ ready }: { readonly ready: Promise<void> }) {
  use(ready);
  return h('main', { id: 'app' }, h('p', null, 'early'));
}

/** `Flip` with nothing to wait for. */
function Mounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return h('p', null, mounted ? 'client' : 'early');
}

/** What `Flip` renders, as a server sends it. */
const SERVED = '<main id="app"><p>early</p></main>';

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
  for (const open of gates.splice(0)) open();
  await ticks();
  for (const root of roots.splice(0)) root.unmount();
  document.body.replaceChildren();
});

function ticks(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A server-rendered container, hydrated with a shell that holds until `open`. */
async function hydrating(component: typeof Flip): Promise<{ readonly container: HTMLElement; open(): void }> {
  const container = document.createElement('div');
  container.innerHTML = SERVED;
  document.body.appendChild(container);

  const held = gate();
  gates.push(held.open);
  roots.push(hydrateRoot(container, h(component, { ready: held.ready })));
  await ticks();
  return { container, open: held.open };
}

/** A container holding `<p>early</p>` inside a `<section>`, hydrated with `Mounted`. */
function served(): { readonly section: HTMLElement; readonly container: HTMLElement } {
  const section = document.createElement('section');
  const container = document.createElement('div');
  container.innerHTML = '<p>early</p>';
  section.appendChild(container);
  document.body.appendChild(section);
  roots.push(hydrateRoot(container, h(Mounted)));
  return { section, container };
}

/** A driver's answer for a shell that holds on one response, which arrives after `afterMs`. */
function arriving(open: () => void, afterMs = 40): () => Promise<boolean> {
  let answered = false;
  return async () => {
    if (answered) return false;
    answered = true;
    await ticks(afterMs);
    open();
    await ticks(0);
    return true;
  };
}

function subjectOf(container: HTMLElement): Element {
  const main = container.querySelector('#app');
  if (main === null) throw new Error('no #app in the container');
  return main;
}

describe('comparing the markup hydration committed with the markup read', () => {
  it('reports nothing when the markup a wait began on is the markup it ended on', async () => {
    const page = await hydrating(Still);

    const settled = await awaitHydration(subjectOf(page.container), { pollMs: 4, tap, outstanding: arriving(page.open) });

    expect(settled.state).toBe('hydrated');
    expect(settled.changed).toBeUndefined();
  });

  it('quotes the markup hydration changed, and names who changed it', async () => {
    const page = await hydrating(Flip);

    const settled = await awaitHydration(subjectOf(page.container), { pollMs: 4, tap, outstanding: arriving(page.open) });

    expect(settled.state).toBe('hydrated');
    expect(settled.changed).toEqual({
      before: '<main id="app"><p>early</p></main>',
      after: '<main id="app"><p>client</p></main>',
      components: ['Flip'],
    });
  });

  /**
   * The comparison does not depend on when the read happens. A fast machine
   * reads a route after its effects have run, a slow one before, and both are
   * told the same thing: the server's markup is copied when React hydrates it.
   */
  it('quotes the markup hydration changed when the read comes after the change', async () => {
    const page = await hydrating(Flip);
    page.open();
    await ticks();
    expect(page.container.textContent).toBe('client');

    const settled = await awaitHydration(subjectOf(page.container), { pollMs: 4, tap });

    expect(settled.changed).toEqual({
      before: '<main id="app"><p>early</p></main>',
      after: '<main id="app"><p>client</p></main>',
      components: ['Flip'],
    });
  });

  it('compares nothing without a tap to say React went quiet', async () => {
    const page = await hydrating(Flip);

    const settled = await awaitHydration(subjectOf(page.container), { pollMs: 4, outstanding: arriving(page.open) });

    expect(settled.state).toBe('hydrated');
    expect(settled.changed).toBeUndefined();
  });

  it('compares the subject holding a root with that root put back as it hydrated', async () => {
    const { section } = served();

    const settled = await awaitHydration(section, { pollMs: 4, tap });

    expect(settled.changed).toEqual({
      before: '<section><div><p>early</p></div></section>',
      after: '<section><div><p>client</p></div></section>',
      components: ['Mounted'],
    });
  });

  it("compares a subject that is a root's container with the container as it hydrated", async () => {
    const { container } = served();

    const settled = await awaitHydration(container, { pollMs: 4, tap });

    expect(settled.changed).toEqual({
      before: '<div><p>early</p></div>',
      after: '<div><p>client</p></div>',
      components: ['Mounted'],
    });
  });

  /** A text node has no markup of its own to quote. */
  it('compares nothing for a subject that is not an element', async () => {
    const { container } = served();
    await ticks();

    const settled = await awaitHydration(container.querySelector('p')!.firstChild!, { pollMs: 4, tap });

    expect(settled.state).toBe('hydrated');
    expect(settled.changed).toBeUndefined();
  });

  /** A root rendered on the client has no server markup to compare with. */
  it('compares nothing on a root that never hydrated', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    root.render(h(Mounted));

    const settled = await awaitHydration(container, { pollMs: 4, tap });

    expect(settled.state).toBe('hydrated');
    expect(container.textContent).toBe('client');
    expect(settled.changed).toBeUndefined();
  });
});
