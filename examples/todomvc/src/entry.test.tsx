// @vitest-environment jsdom
//
// `tapCommits()` runs at module scope and every other import is dynamic
// underneath it. That is not style: `react-dom` looks for the DevTools hook when
// its module body runs, so a static import anywhere above this line would install
// the tap too late, and a tap that attached too late hears nothing — which is
// indistinguishable from a page that has gone quiet. The refusal in `commits.ts`
// exists for exactly that, and the ordering here is what keeps it from firing.

import { describe, expect, it } from 'vitest';
import { awaitQuiet, tapCommits } from '@variance-authority/react';
// Type-only, so it is erased before anything runs and cannot load a module.
import type { ComponentInstance, Viewport } from '@variance-authority/core';

const tap = tapCommits();

const { createRoot } = await import('react-dom/client');
const { Suspense, act, createElement: h, use, useEffect, useState } = await import('react');
const { componentInstances, normalize } = await import('@variance-authority/core');
const { collect } = await import('@variance-authority/dom');
const { pendingSuspense, portalContentOf, provenanceOf } = await import(
  '@variance-authority/react'
);
const { Card, Chip, Stack, Text } = await import('./ds/components.js');
const { DS_CSS } = await import('./ds/styles.js');
const { TOKENS_CSS } = await import('./tokens/foundation.js');

/**
 * Where a change enters the room, on one page, with all three instruments on it.
 *
 * The rest of this suite reads pages that have stopped moving. This one is built
 * so that it has *not* stopped, in the two ways a real application does not stop:
 * a subtree still waiting on data, and a component committing on a timer. Both
 * are ordinary. Both produce a document that differs from the document the same
 * page produces a moment later, and neither difference was made by anybody.
 *
 * The state of the art meets both of these in pixel space — screenshot until two
 * consecutive images agree, and on failure report that the page kept changing.
 * That is a raster per poll and a timeout that names nothing. Everything below
 * runs before a pixel exists.
 *
 * ## What each instrument is for
 *
 * | Question | Instrument | What it answers with |
 * |---|---|---|
 * | is the application still rendering? | `awaitQuiet` | the components still committing, by name |
 * | which subtree has not arrived? | `pendingSuspense` | the boundary, its owner chain, and who wrote it |
 * | did it matter? | `componentInstances` | the component and band that moved |
 *
 * The last one is the control. Without it the first two are a claim that
 * something *might* have been read too early; with it, this file measures a
 * document read too early, shows it differs, and shows that the component it
 * differs in is the one the boundary named — **before** the second document
 * existed to compare against.
 *
 * ## What this does not do
 *
 * No collector calls any of this. `settle()` decides a page is ready from the
 * network and the document digest, and wiring these in is a policy question —
 * what a run does when the tap refuses — not a plumbing one. So this file is the
 * demonstration, and [`stabilization.md`](../../../docs/stabilization.md) says so
 * in the same words.
 */

const VIEWPORT: Viewport = { width: 1024, height: 768, deviceScaleFactor: 1, colorScheme: 'light' };

type ActEnvironment = { IS_REACT_ACT_ENVIRONMENT?: boolean };

/** A promise the test settles by hand, so "still waiting" is a state we hold. */
function deferred(): { promise: Promise<readonly string[]>; resolve: () => void } {
  let settle!: (value: readonly string[]) => void;
  const promise = new Promise<readonly string[]>((resolveWith) => {
    settle = resolveWith;
  });
  return { promise, resolve: () => settle(['Buy milk', 'Walk the dog']) };
}

function sheets(): void {
  document.head.innerHTML = '';
  for (const [name, css] of [
    ['tokens', TOKENS_CSS],
    ['design-system', DS_CSS],
  ] as const) {
    const sheet = document.createElement('style');
    sheet.setAttribute('data-entry-sheet', name);
    sheet.textContent = css;
    document.head.appendChild(sheet);
  }
}

function read(subject: Element): readonly ComponentInstance[] {
  return componentInstances(
    normalize(
      collect(subject, {
        subject: { id: 'entry', kind: 'story' },
        viewport: VIEWPORT,
        engine: 'jsdom@entry',
        fonts: ['system/400/normal/entry'],
        provenanceOf,
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

function subjectNode(): Element {
  const element = document.querySelector('[data-t="subject"]');
  if (!element) throw new Error('no subject');
  return element;
}

describe('a page that has not finished arriving', () => {
  it('names the boundary before the difference exists, and the difference lands where it said', async () => {
    (globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;
    sheets();

    const data = deferred();

    function TodoList({ items }: { items: Promise<readonly string[]> }) {
      return h(
        Stack,
        null,
        ...use(items).map((label) => h(Text, { key: label }, label)),
      );
    }

    function TodoPanel() {
      // The `<Suspense>` this test is about, written by this component — which is
      // what `createdBy` reports, and it is not the component that encloses it.
      return h(
        Suspense,
        { fallback: h(Text, { tone: 'muted' }, 'Loading…') },
        h(TodoList, { items: data.promise }),
      );
    }

    function Page() {
      return h(
        'section',
        { 'data-t': 'subject' },
        h(Card, null, h(Stack, null, h(Chip, { label: 'All', selected: true }), h(TodoPanel, null))),
      );
    }

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(h(Page, null));
    });

    // 1. The instrument speaks first. One boundary, pending, and it is named by
    //    the components above it rather than by a spinner's CSS selector.
    const waiting = pendingSuspense(subjectNode());
    expect(waiting).toHaveLength(1);
    // `owners` is the enclosure chain, so it contains `Stack` — a flexbox
    // primitive that knows nothing about todo lists. That is the same tension
    // journal 0017 measured on the component graph, and the same answer applies:
    // enclosure says where the boundary sits, `createdBy` says who wrote it, and
    // a reader wants the second one.
    expect(waiting[0]?.owners).toEqual(['TodoPanel', 'Stack', 'Card', 'Page']);
    expect(waiting[0]?.createdBy).toBe('TodoPanel');

    // 2. The document a run would have stored if it read the page now. Nothing
    //    about it looks wrong — it is a complete, valid, internally consistent
    //    snapshot of a fallback.
    const early = read(subjectNode());

    await act(async () => {
      data.resolve();
      await data.promise;
    });

    expect(pendingSuspense(subjectNode())).toEqual([]);
    const settled = read(subjectNode());

    // 3. The two documents disagree, and this is the flake: a real difference
    //    between two readings of one page at one revision, which no pixel
    //    comparison could attribute to anything but "the screenshot moved".
    expect(instance(early, 'TodoPanel').rendering).not.toBe(
      instance(settled, 'TodoPanel').rendering,
    );

    // 4. And it lands exactly where the boundary said it would. `Chip`, which is
    //    inside the subject and outside the boundary, is byte-identical across
    //    both readings — so the movement is attributable to `TodoPanel` and not
    //    to "something on the page".
    expect(instance(early, 'Chip').rendering).toBe(instance(settled, 'Chip').rendering);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});

describe('a page that never finishes', () => {
  it('names what is still committing, and leaves out what merely mounted', async () => {
    // `act` off on purpose: the whole subject is an application committing
    // outside anybody's control, which is what `act` exists to prevent.
    (globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = false;
    sheets();

    function LiveCount() {
      const [seconds, setSeconds] = useState(0);
      useEffect(() => {
        const id = setInterval(() => setSeconds((value) => value + 1), 5);
        return () => clearInterval(id);
      }, []);
      return h(Text, { tone: 'muted' }, `${String(seconds)}s ago`);
    }

    function Page() {
      return h(
        'section',
        { 'data-t': 'subject' },
        h(Card, null, h(Stack, null, h(Chip, { label: 'Active' }), h(LiveCount, null))),
      );
    }

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    root.render(h(Page, null));
    await new Promise((resolve) => setTimeout(resolve, 30));

    const quiet = await awaitQuiet(tap, { quietFor: 60, timeout: 250 });

    expect(quiet.settled).toBe(false);
    // The sentence a reader gets instead of a screenshot timeout.
    expect(quiet.restless[0]?.name).toBe('LiveCount');
    expect(quiet.restless[0]?.commits).toBeGreaterThan(1);
    // `Page`, `Card` and `Chip` rendered once, at mount, and never again — so
    // they are absent from the list rather than sitting at the bottom of it with
    // a count of one. A report that named them would send a reader to four
    // components that did nothing.
    const named = quiet.restless.map((entry) => entry.name);
    expect(named).not.toContain('Page');
    expect(named).not.toContain('Chip');

    root.unmount();
    container.remove();
    (globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('is attached, which is the only reason the silence above means anything', () => {
    // Stated as its own case because it is the load-bearing one. Every
    // assertion in this file that reads "nothing committed" is worthless from a
    // tap that never heard anything, and a tap installed after `react-dom` hears
    // nothing forever.
    expect(tap.attached).toBe(true);
    expect(tap.reason).toBeUndefined();
    expect(tap.reactVersion).toMatch(/^\d+\.\d+\.\d+/);
  });
});
