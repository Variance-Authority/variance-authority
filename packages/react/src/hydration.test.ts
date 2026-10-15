// @vitest-environment jsdom
//
// Real React, for the reason `suspense.test.tsx` gives: a fake `memoizedState`
// would assert that this file agrees with itself, and the claim of the module
// is that it agrees with React about whether a root has committed.
//
// And a real commit tap, installed at module scope with `react-dom` imported
// underneath it, for the reason `commits.test.tsx` gives: a static import would
// load react-dom before the hook existed, and the tap would hear nothing.

import { createElement as h, startTransition, use } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { tapCommits, type CommitTap } from './commits.js';
import { hasFiber } from './fiber.js';
import { awaitHydration } from './hydration.js';
import { UNCOMMITTED, resolveProvenance } from './resolve.js';
import { componentFiberOf, wiringOf } from './wiring.js';

const tap = tapCommits();

const { createPortal } = await import('react-dom');
const { createRoot, hydrateRoot } = await import('react-dom/client');

type Root = ReturnType<typeof createRoot>;

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
async function hydrating(
  component: typeof App = App,
  markup = MARKUP,
): Promise<{ readonly container: HTMLElement; open(): void }> {
  const container = document.createElement('div');
  container.innerHTML = markup;
  document.body.appendChild(container);

  const held = gate();
  gates.push(held.open);
  roots.push(hydrateRoot(container, h(component, { ready: held.ready })));
  await ticks();
  return { container, open: held.open };
}

/**
 * What a driver answers for a page whose shell holds on one response: it is
 * still arriving, it arrives and settles the promise, and then nothing is
 * outstanding.
 */
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

    const settled = await awaitHydration(subjectOf(page.container), { pollMs: 4 });

    expect(settled).toMatchObject({ state: 'hydrating', roots: 1, pending: 1 });
  });

  /**
   * The suspended shell has no work React can do: whatever settles its promise
   * arrives from outside. With nothing outstanding to bring it, waiting longer
   * is waiting for nothing, and the subject is read as it stands at once.
   */
  it('stops at once on a suspended shell when nothing is arriving to settle it', async () => {
    const page = await hydrating();
    const asked: string[] = [];

    const settled = await awaitHydration(subjectOf(page.container), {
      pollMs: 4,
      outstanding: async (of) => {
        asked.push(of);
        return false;
      },
    });

    expect(settled).toMatchObject({ state: 'hydrating', roots: 1, pending: 1 });
    // The promise can be on any request: a chunk, a payload, a long poll.
    expect(asked).toEqual(['any']);
    expect(settled.waitedMs).toBeLessThan(20);
  });

  /**
   * A shell hydrated inside a transition suspends on a transition lane rather
   * than the default one. React marks it suspended all the same, so it reads as
   * work React cannot do, and the wait asks the wire rather than following a
   * render that is not coming.
   */
  it('stops on a shell hydrated in a transition when nothing is arriving to settle it', async () => {
    const container = document.createElement('div');
    container.innerHTML = MARKUP;
    document.body.appendChild(container);
    const held = gate();
    gates.push(held.open);
    startTransition(() => {
      roots.push(hydrateRoot(container, h(App, { ready: held.ready })));
    });
    await ticks();

    const settled = await awaitHydration(subjectOf(container), { pollMs: 4, outstanding: async () => false });

    expect(settled).toMatchObject({ state: 'hydrating', roots: 1, pending: 1 });
  });

  /**
   * The fiber on `<span>` belongs to a render React has not committed, and may
   * never commit: a hydration that fails is thrown away and rendered again on
   * the client. A component read off it would be reported as observed when
   * nothing on screen came from it.
   */
  it('reads no component off a node whose root has not committed', async () => {
    const page = await hydrating();
    const span = page.container.querySelector('span')!;
    expect(hasFiber(span)).toBe(true);

    expect(resolveProvenance(span)).toBe(UNCOMMITTED);
    expect(resolveProvenance(span)).toMatchObject({ status: 'no-fiber', reason: 'uncommitted' });
    expect(wiringOf(span)).toBeUndefined();
    expect(componentFiberOf(span)).toBeNull();

    await awaitHydration(subjectOf(page.container), { pollMs: 4, outstanding: arriving(page.open, 0) });

    const resolved = resolveProvenance(span);
    expect(resolved.status).toBe('resolved');
    if (resolved.status === 'resolved') expect(resolved.provenance.owners[0]?.name).toBe('Header');
    expect(componentFiberOf(span)).not.toBeNull();
  });

  it('returns once React commits the hydration, however long the shell held', async () => {
    const page = await hydrating();

    const settled = await awaitHydration(subjectOf(page.container), {
      pollMs: 4,
      outstanding: arriving(page.open, 120),
    });

    expect(settled).toMatchObject({ state: 'hydrated', roots: 1, pending: 0 });
    expect(settled.waitedMs).toBeGreaterThanOrEqual(100);
    expect(hasFiber(page.container.querySelector('p')!)).toBe(true);
  });

  it('returns on the first read of a subject already hydrated', async () => {
    const page = await hydrating();
    page.open();
    await ticks();

    const settled = await awaitHydration(subjectOf(page.container));

    expect(settled).toMatchObject({ state: 'hydrated', roots: 1, pending: 0 });
    expect(settled.waitedMs).toBeLessThan(50);
  });

  /**
   * A root that committed before the wait was asked can still have effects
   * React has not run, and an effect is where a client changes what the server
   * sent. Read before they run, the page is read one change early.
   */
  it('waits for the effects of a root that had already committed', async () => {
    const page = await hydrating();
    page.open();
    await ticks();
    let asked = 0;
    const flushing = { ...tap, attached: true, effectsPending: () => (asked += 1) <= 3 } as CommitTap;

    const settled = await awaitHydration(subjectOf(page.container), { pollMs: 4, tap: flushing });

    expect(settled).toMatchObject({ state: 'hydrated', roots: 1, pending: 0 });
    expect(asked).toBeGreaterThan(3);
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

    expect(await awaitHydration(section, { pollMs: 4 })).toMatchObject({
      state: 'hydrating',
      roots: 1,
      pending: 1,
    });

    expect(await awaitHydration(section, { pollMs: 4, outstanding: arriving(held.open, 0) })).toMatchObject({
      state: 'hydrated',
      roots: 1,
      pending: 0,
    });
  });

  /**
   * A root that committed nothing is committed. Its `element` is `null` either
   * way, so what tells it from a root still on its first render is whether a
   * render ran (`current.alternate`) and whether work is left (`pendingLanes`).
   */
  it('reads a root that committed `null` as committed, and one never rendered as not', async () => {
    const section = document.createElement('section');
    const container = document.createElement('div');
    section.appendChild(container);
    document.body.appendChild(section);

    const root = createRoot(container);
    roots.push(root);
    await ticks();
    expect(await awaitHydration(section, { pollMs: 4 })).toMatchObject({
      state: 'hydrating',
      pending: 1,
    });

    root.render(null);
    await ticks();
    expect(await awaitHydration(section, { pollMs: 4 })).toMatchObject({
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

    const settled = await awaitHydration(outside.querySelector('em')!);

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

    const settled = await awaitHydration(plain, { pollMs: 4 });

    expect(settled).toMatchObject({ state: 'unrooted', roots: 0, pending: 0 });
  });

  /**
   * A client that has not created its root yet is waiting on its own bundle,
   * which arrives over the wire like anything else. The wait follows it, and
   * reads the subject the root reaches once it does.
   */
  it('follows a client still arriving to the root it creates', async () => {
    const container = document.createElement('div');
    container.innerHTML = '<main id="app"><span>early</span><p>late</p></main>';
    document.body.appendChild(container);
    const held = gate();
    gates.push(held.open);
    let created = false;

    const settled = await awaitHydration(subjectOf(container), {
      pollMs: 4,
      outstanding: async () => {
        if (created) return false;
        created = true;
        roots.push(hydrateRoot(container, h(App, { ready: held.ready })));
        held.open();
        await ticks(0);
        return true;
      },
    });

    expect(settled).toMatchObject({ state: 'hydrated', roots: 1, pending: 0 });
  });

  /**
   * A tap installed before the page's scripts that saw no React load says no
   * root is coming yet, not that none will: a renderer can still be on the wire,
   * in a chunk the page imports late. Read once nothing the page asked for is.
   */
  it('reads a page React never loaded on once nothing is arriving', async () => {
    const plain = document.createElement('main');
    plain.innerHTML = '<p>static</p>';
    document.body.appendChild(plain);
    // The tap's own answer on such a page; React has loaded in this one.
    const unloaded = { ...tap, attached: true, reactVersion: undefined } as CommitTap;

    const asked: string[] = [];
    const settled = await awaitHydration(plain, {
      pollMs: 4,
      tap: unloaded,
      outstanding: async (of) => {
        asked.push(of);
        return false;
      },
    });

    expect(settled).toMatchObject({ state: 'unrooted', roots: 0, pending: 0, loaded: false });
    // Only a script brings a renderer: a request of any other kind, a long poll
    // held open, is not one the page needs for React to arrive.
    expect(asked).toEqual(['script']);
  });

  it('follows a renderer still arriving to the root it hydrates', async () => {
    const container = document.createElement('div');
    container.innerHTML = MARKUP;
    document.body.appendChild(container);
    const held = gate();
    gates.push(held.open);
    let loaded = false;
    const late = {
      ...tap,
      attached: true,
      get reactVersion() {
        return loaded ? tap.reactVersion : undefined;
      },
    } as CommitTap;

    const asked: string[] = [];
    const settled = await awaitHydration(subjectOf(container), {
      pollMs: 4,
      tap: late,
      outstanding: async (of) => {
        asked.push(of);
        if (loaded) return false;
        loaded = true;
        roots.push(hydrateRoot(container, h(App, { ready: held.ready })));
        held.open();
        await ticks(0);
        return true;
      },
    });

    expect(settled).toMatchObject({ state: 'hydrated', roots: 1, pending: 0 });
    expect(settled.loaded).toBeUndefined();
    expect(asked).toEqual(['script']);
  });
});
