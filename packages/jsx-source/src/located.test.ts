// @vitest-environment jsdom
//
// Written as calls rather than as JSX, because the argument list *is* the thing
// under test. Every line below is what an automatic-dev transform emits — the
// shape esbuild, Babel and TypeScript all agree on — so a reader can check the
// claim against their own build output instead of against a compiler setting
// they have to take on faith. The real setting is proved once, end to end, by
// the Storybook case.

import { propsDigest } from '@variance-authority/core/format';
import { provenanceOf } from '@variance-authority/react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { jsxDEV } from './jsx-dev-runtime.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

/** The fifth argument, exactly as a transform fills it. */
function at(lineNumber: number, columnNumber: number) {
  return { fileName: 'src/catalogue.jsx', lineNumber, columnNumber };
}

function node(selector: string): Element {
  const found = container.querySelector(selector);
  if (!found) throw new Error(`no node matching ${selector}`);
  return found;
}

function sourceOf(selector: string): unknown {
  return provenanceOf(node(selector))?.source;
}

function Badge({ label }: { label: string }) {
  return jsxDEV('span', { className: 'badge', children: label }, undefined, false, at(12, 4));
}

/** Three elements, one of them keyed, all from one file. */
function Catalogue({ ids }: { ids: readonly string[] }) {
  return jsxDEV(
    'ul',
    {
      className: 'catalogue',
      children: ids.map((id) =>
        jsxDEV(
          'li',
          { children: jsxDEV(Badge, { label: id }, undefined, false, at(24, 11)) },
          id,
          false,
          at(23, 9),
        ),
      ),
    },
    undefined,
    false,
    at(21, 5),
  );
}

describe('a location the transform computed reaches the DOM node', () => {
  beforeEach(async () => {
    await render(jsxDEV(Catalogue, { ids: ['a', 'b'] }, undefined, false, at(40, 3)));
  });

  it('answers with the file and line that wrote the element', () => {
    expect(sourceOf('ul.catalogue')).toEqual({ file: 'src/catalogue.jsx', line: 21, column: 5 });
    expect(sourceOf('span.badge')).toEqual({ file: 'src/catalogue.jsx', line: 12, column: 4 });
  });

  it('keeps the location on a keyed element', () => {
    // The one case that needed handling. React rebuilds the props object when a
    // `key` is present and rebuilds it with `for…in`, which does not see symbols
    // — so without lifting the key out first, every element in every list would
    // have been the one kind that arrives with no location.
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(sourceOf('li')).toEqual({ file: 'src/catalogue.jsx', line: 23, column: 9 });
  });

  it('still lets React own the element', () => {
    // Interception that broke keys, owners or the chain would be a bad trade for
    // a line number. `createdBy` in particular is React's own development
    // bookkeeping, and it is only populated if React created the element.
    const provenance = provenanceOf(node('span.badge'));
    expect(provenance?.owners.map((frame) => frame.name)).toEqual(['Badge', 'Catalogue']);
    expect(provenance?.createdBy).toBe('Badge');
  });

  it('puts nothing in the document', () => {
    // A string key would have been rendered as an attribute on every host
    // element, which would change the very bytes this project compares.
    expect([...node('span.badge').attributes].map((attribute) => attribute.name)).toEqual([
      'class',
    ]);
    expect(container.innerHTML).toBe(
      '<ul class="catalogue"><li><span class="badge">a</span></li>' +
        '<li><span class="badge">b</span></li></ul>',
    );
  });
});

describe('a location changes nothing that is compared', () => {
  it('does not enter the props digest', async () => {
    // Load-bearing, and the reason for a symbol rather than a property anyone
    // could enumerate. Digesting the location would mean inserting a line at the
    // top of a file moved the props digest of every component below it, and §6.2
    // would read a whole file as having changed from the outside.
    await render(jsxDEV(Badge, { label: 'a' }, undefined, false, at(40, 3)));
    const first = provenanceOf(node('span.badge'))?.owners[0]?.propsDigest;

    // The same call site, moved down the file by an edit above it.
    await render(jsxDEV(Badge, { label: 'a' }, undefined, false, at(900, 77)));
    const moved = provenanceOf(node('span.badge'))?.owners[0]?.propsDigest;

    expect(first).toBe(propsDigest({ label: 'a' }));
    expect(moved).toBe(first);
    expect(sourceOf('span.badge')).toEqual({ file: 'src/catalogue.jsx', line: 12, column: 4 });
  });
});

describe('a build that emits no location', () => {
  it('renders exactly as React would, and reports no source', async () => {
    // The production transform passes no fifth argument. Absence has to stay a
    // normal state: `source` is omitted rather than filled with a placeholder,
    // because a placeholder is a claim about a file.
    await render(jsxDEV('p', { className: 'plain', children: 'x' }, undefined, false));

    expect(node('p.plain').textContent).toBe('x');
    expect(provenanceOf(node('p.plain'))?.source).toBeUndefined();
  });
});
