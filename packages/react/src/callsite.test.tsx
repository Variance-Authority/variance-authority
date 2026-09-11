// @vitest-environment jsdom
//
// **This file is the zero-configuration claim, and it is checkable because it is
// written in JSX.** Nothing here is configured to produce a location: no
// `jsxImportSource`, no plugin, no `jsxDev` flag — Vitest's own esbuild
// transform, on a `.tsx` file, exactly as any project's would be. What the
// assertions read is an `Error` React captured inside its own `jsxDEV`, which is
// present because React is the development build and for no other reason.
//
// **The line numbers below are load-bearing.** Editing above a marked line
// breaks a test on purpose: an assertion that the recorded line is *some* line
// would pass while pointing a reviewer at the wrong one, which is the failure
// this whole path exists to prevent.

import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JSX_SOURCE } from '@variance-authority/core/format';
import { provenanceOf } from './index.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Badge({ label }: { label: string }) {
  return <span data-t="badge">{label}</span>; // ← line 24, column 10
}

function List() {
  return (
    <ul data-t="list">
      <li data-t="item">one</li> {/* ← line 30, column 7 */}
    </ul>
  );
}

function App() {
  return (
    <section data-t="section">
      <Badge label="n" />
      <List />
    </section>
  );
}

const BADGE_SPAN = { line: 24, column: 10 };
const LIST_ITEM = { line: 30, column: 7 };

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

function framesOf(marker: string) {
  const provenance = provenanceOf(find(marker));
  if (!provenance) throw new Error(`expected a fiber for ${marker}`);
  return provenance.stack ?? [];
}

describe('the call site React captured on its own', () => {
  beforeEach(async () => {
    await render(<App />);
  });

  it('names the line and column the element is written on', () => {
    // Under a Node test runner the engine has already applied the source map, so
    // the frame is the answer outright. In a browser it is not, and the same
    // frame goes to `writerLocationOf` with a map. Both ends are the same read.
    expect(framesOf('badge')[0]).toMatchObject(BADGE_SPAN);
  });

  it('names the element, not the component that returned it', () => {
    // `Badge` is declared on line 22 and the `<span>` is written on 23. Naming
    // the declaration is the failure mode a reviewer notices immediately, and
    // the one the recorded-symbol path was built to avoid.
    expect(framesOf('badge')[0]?.line).toBe(BADGE_SPAN.line);
  });

  it('distinguishes two elements written by the same component', () => {
    const item = framesOf('item')[0];
    const list = framesOf('list')[0];

    expect(item).toMatchObject(LIST_ITEM);
    expect(list?.line).not.toBe(item?.line);
  });

  it('reports the file the reviewer would open', () => {
    expect(framesOf('badge')[0]?.url).toContain('callsite.test.tsx');
  });

  it('carries React itself in no frame it hands on', () => {
    // Frame zero of the raw stack is always React's `jsxDEV`. Everything below
    // the author is `react-dom`. Neither may survive the filter, or the
    // collector spends a fetch on a megabyte of runtime to be told nothing.
    for (const frame of framesOf('badge')) {
      expect(frame.url).not.toContain('node_modules');
    }
  });

  it('keeps the shortlist short', () => {
    // Everything above the author is filtered and everything below it is
    // `react-dom`; what is left is the author and, at most, a couple of callers.
    expect(framesOf('badge').length).toBeLessThanOrEqual(4);
  });
});

describe('the reach of it', () => {
  it('covers an element written with createElement, which no transform touched', async () => {
    // Measured, and further than expected: React 19 captures the error in
    // `createElement` too, not only in `jsx`/`jsxDEV`. So this locates a
    // hand-written element and a class component's `render` — code the automatic
    // transform never sees, and which therefore has no `__source` to record and
    // nowhere for a JSX runtime to stand.
    function Manual() {
      return h('p', { 'data-t': 'manual' });
    }
    await render(h(Manual, null));

    const frame = provenanceOf(find('manual'))?.stack?.[0];
    expect(frame?.url).toContain('callsite.test.tsx');
    expect(frame?.function).toBe('Manual');
  });

  it('yields to a location a runtime recorded, rather than duplicating it', async () => {
    // `jsx-source` writes an exact location and needs no map. Where it is
    // installed this path must not run at all — it would cost a stack read per
    // node to arrive at an answer already in hand.
    //
    // Spread rather than `createElement`: React's `createElement` copies config
    // with `for…in`, which does not copy symbols. That is the same mechanism
    // that costs the `css`-prop case a fiber (journal 0021), met here from the
    // other side.
    const recorded = { [JSX_SOURCE]: { file: 'src/ds.jsx', line: 53, column: 5 } };
    function Recorded() {
      return <p data-t="recorded" {...recorded} />;
    }
    await render(<Recorded />);

    const provenance = provenanceOf(find('recorded'));
    expect(provenance?.source).toEqual({ file: 'src/ds.jsx', line: 53, column: 5 });
    expect(provenance?.stack).toBeUndefined();
  });
});
