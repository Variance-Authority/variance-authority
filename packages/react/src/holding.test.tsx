// @vitest-environment jsdom
//
// Every assertion here is a measurement of a React internal, and the failure
// this file exists to catch is not an exception. It is a hook cell filed under
// the wrong hook: React records hook *names* in one place and hook *cells* in
// another, the two are not parallel arrays, and a reader that zipped them would
// report a `useMemo` digest for a `useCallback`, an effect object as state, and
// a cause at the wrong line of the right component. So the cases below assert
// arity and content, never mere presence.

import * as React from 'react';
import { createElement as h, act, createContext, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { heldDigest } from '@variance-authority/core';
import { holdingOf } from './holding.js';
import { componentFiberOf } from './wiring.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// `React.use` and friends through a loose alias: this package compiles against
// whatever React the workspace resolved, and the test is about the runtime.
const R = React as unknown as Record<string, (...args: never[]) => unknown>;

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

const Theme = createContext<unknown>('light');
Theme.displayName = 'Theme';

describe('the join between hook names and hook cells', () => {
  it('keeps its place across a hook that builds no cell', async () => {
    // The alignment case, stated as the difference it makes. `useContext` sits
    // between two `useState`s and contributes nothing to the cell chain, so a
    // positional zip files the second state's cell under the context's name and
    // reports the *third* hook as holding the second one's value.
    function Interleaved() {
      React.useState('first');
      React.useContext(Theme);
      React.useState('second');
      return h('span', { 'data-t': 'i' });
    }

    await render(h(Theme.Provider, { value: 'dark' }, h(Interleaved, null)));
    const holding = holdingOf(at('i'));

    expect(holding?.cells).toEqual([
      { index: 0, hook: 'useState', digest: heldDigest('first') },
      { index: 2, hook: 'useState', digest: heldDigest('second') },
    ]);
    // Index 1 is absent rather than renumbered: the number is the one a reader
    // arrives at by counting hook calls, so it must survive a gap.
    expect(holding?.cells?.map((cell) => cell.index)).toEqual([0, 2]);
  });

  it('counts the two cells a store subscription builds, and reads the store', async () => {
    // `useSyncExternalStore` is the row that makes "external state" a fact this
    // package can read without knowing any store library's name. It builds two
    // cells — the snapshot and an effect — and a reader that assumed one would
    // hand the *next* hook the effect object.
    const snapshot = { items: 3 };
    function Bound() {
      React.useSyncExternalStore(
        () => () => undefined,
        () => snapshot,
      );
      React.useState('after');
      return h('span', { 'data-t': 'b' });
    }

    await render(h(Bound, null));

    expect(holdingOf(at('b'))?.cells).toEqual([
      { index: 0, hook: 'useSyncExternalStore', digest: heldDigest(snapshot) },
      { index: 1, hook: 'useState', digest: heldDigest('after') },
    ]);
  });

  it('digests deps rather than the cell for memos and effects', async () => {
    // A `useMemo` cell is `[value, deps]` and a `useCallback` value is a closure
    // rebuilt every render; an effect cell's `next` closes a ring, and walking
    // one is an out-of-memory kill rather than a bad digest.
    function Derived() {
      React.useMemo(() => 'computed', ['dep-a']);
      React.useCallback(() => undefined, ['dep-b']);
      React.useEffect(() => undefined, ['dep-c']);
      return h('span', { 'data-t': 'd' });
    }

    await render(h(Derived, null));

    expect(holdingOf(at('d'))?.cells).toEqual([
      { index: 0, hook: 'useMemo', digest: heldDigest(['dep-a']) },
      { index: 1, hook: 'useCallback', digest: heldDigest(['dep-b']) },
      { index: 2, hook: 'useEffect', digest: heldDigest(['dep-c']) },
    ]);
  });

  it('reaches through a ref to what it holds', async () => {
    // The ref object's identity is stable across renders, so digesting the cell
    // would report every ref as unchanged for the lifetime of the component.
    function Held() {
      React.useRef('kept');
      return h('span', { 'data-t': 'r' });
    }

    await render(h(Held, null));

    expect(holdingOf(at('r'))?.cells).toEqual([
      { index: 0, hook: 'useRef', digest: heldDigest('kept') },
    ]);
  });

  it('is not shifted by `use`, which React records nowhere', async () => {
    // `use` appears in neither record, so it cannot move the join. Asserted
    // interleaved rather than alone, because "invisible" is a claim about the
    // dangerous position.
    const resolved = Promise.resolve('awaited');
    function Uses() {
      React.useState('before');
      R.use(resolved as never);
      React.useState('after');
      return h('span', { 'data-t': 'u' });
    }

    await render(h(Suspense, { fallback: null }, h(Uses, null)));

    expect(holdingOf(at('u'))?.cells).toEqual([
      { index: 0, hook: 'useState', digest: heldDigest('before') },
      { index: 1, hook: 'useState', digest: heldDigest('after') },
    ]);
  });
});

describe('a hook this reader does not know', () => {
  it('truncates the read and names it, rather than misaligning the rest', async () => {
    // A React release that adds a hook is the case this defends. The name is
    // injected onto the fiber because that is precisely what such a release
    // would do, and the assertion is that the cells *before* it survive and the
    // ones after it are not invented.
    function Future() {
      React.useState('reachable');
      React.useState('past-the-unknown');
      return h('span', { 'data-t': 'f' });
    }

    await render(h(Future, null));

    const fiber = componentFiberOf(at('f')) as { _debugHookTypes: string[] } | null;
    if (fiber === null) throw new Error('no component fiber');
    fiber._debugHookTypes = ['useState', 'useSomethingNew', 'useState'];

    const holding = holdingOf(at('f'));

    expect(holding?.cells).toEqual([{ index: 0, hook: 'useState', digest: heldDigest('reachable') }]);
    expect(holding?.unread).toBe('useSomethingNew');
  });
});

describe('what a boundary was handed and what it read', () => {
  it('names each prop, and excludes children', async () => {
    function Leaf() {
      return h('span', { 'data-t': 'l' });
    }
    function Wrapper(props: { tone: string; count: number; children?: unknown }) {
      return h('div', null, props.children);
    }

    await render(h(Wrapper, { tone: 'warn', count: 2 }, h(Leaf, null)));

    // Read at the wrapper's own root node, which is the `div` it authored.
    const holding = holdingOf(container.querySelector('div')!);
    expect(holding?.props).toEqual([
      { name: 'count', digest: heldDigest(2) },
      { name: 'tone', digest: heldDigest('warn') },
    ]);
    expect(holding?.props?.map((prop) => prop.name)).not.toContain('children');
  });

  it('reads a context value, which no hook cell carries', async () => {
    function Consumer() {
      React.useContext(Theme);
      return h('span', { 'data-t': 'c' });
    }

    await render(h(Theme.Provider, { value: { mode: 'dark' } }, h(Consumer, null)));

    expect(holdingOf(at('c'))?.contexts).toEqual([
      { name: 'Theme', digest: heldDigest({ mode: 'dark' }) },
    ]);
  });
});

describe('what this refuses to claim', () => {
  it('is absent on a node no framework rendered', () => {
    const plain = document.createElement('div');
    document.body.appendChild(plain);
    try {
      // Absent, never an empty object: a page with no adapter must not compare
      // equal to a page this reader understood perfectly (ADR-0002).
      expect(holdingOf(plain)).toBeUndefined();
    } finally {
      plain.remove();
    }
  });

  it('separates a state that holds `undefined` from a cell that is not there', async () => {
    function Maybe() {
      React.useState<string | undefined>(undefined);
      return h('span', { 'data-t': 'm' });
    }

    await render(h(Maybe, null));

    const cells = holdingOf(at('m'))?.cells;
    expect(cells).toHaveLength(1);
    expect(cells?.[0]?.digest).toBe(heldDigest(undefined));
    // The digest of `undefined` is a value, and it is not the digest of a value
    // that was never read. A state going from `undefined` to defined is a
    // change, and collapsing the two would hide it.
    expect(heldDigest(undefined)).not.toBe(heldDigest(null));
  });
});
