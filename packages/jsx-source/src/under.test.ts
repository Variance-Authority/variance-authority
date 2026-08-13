// @vitest-environment jsdom
//
// The claim under test is composition: a project that already points
// `jsxImportSource` at a custom runtime keeps pointing it there, and still gets a
// source location on every element.
//
// Emotion is the subject rather than a stand-in written to pass. Its dev runtime
// is a real six-argument pass-through that swaps the element type when a `css`
// prop is present, and that swap is the one place the mechanism has a boundary —
// a boundary worth asserting rather than describing.
//
// The module swap itself is performed here with `createRequire`, because React's
// development runtime is CommonJS and Emotion reads `jsxDEV` off the namespace at
// call time. That is the same substitution `jsxSource()` performs at resolution,
// done in-process so the test needs no bundler. The *installation* is proved end
// to end, through a minified production build, by the Storybook case.

import { propsDigest } from '@variance-authority/core';
import { provenanceOf } from '@variance-authority/react';
import { createRequire } from 'node:module';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { under } from './under.js';

const require = createRequire(import.meta.url);

interface DevNamespace {
  Fragment: unknown;
  jsxDEV?: unknown;
}

type Jsx = (
  type: unknown,
  props: unknown,
  key?: unknown,
  isStatic?: boolean,
  source?: unknown,
  self?: unknown,
) => unknown;

/**
 * Put the recording runtime underneath React's, exactly where a resolution swap
 * would put it, and only then let Emotion bind to it.
 */
const reactDev = require('react/jsx-dev-runtime') as DevNamespace;
const reactProd = require('react/jsx-runtime') as { jsx: Jsx; jsxs: Jsx };
const recording = under({ ...reactDev } as never, reactProd as never);
reactDev.jsxDEV = recording.jsxDEV;

const emotion = require('@emotion/react/jsx-dev-runtime') as { jsxDEV: Jsx };
const { css } = require('@emotion/react') as { css: (...args: never[]) => unknown };

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

/**
 * What the report would resolve, walking the fibers the way `resolveProvenance`
 * does: the element's own location, or the nearest one above it.
 */
function sourceOf(selector: string): unknown {
  return provenanceOf(node(selector))?.source;
}

describe('a runtime layered above this one', () => {
  it('records the location of an element the layer passes straight through', async () => {
    await render(emotion.jsxDEV('span', { className: 'badge' }, undefined, false, at(12, 4)));

    expect(sourceOf('span.badge')).toEqual({ file: 'src/catalogue.jsx', line: 12, column: 4 });
  });

  it('keeps the layer working', async () => {
    await render(
      emotion.jsxDEV(
        'b',
        { className: 'styled', css: css`color: red` },
        undefined,
        false,
        at(20, 6),
      ),
    );

    // Emotion still resolved the `css` prop into a generated class. Recording
    // underneath a runtime must not change what that runtime does.
    expect(node('b.styled').className).toMatch(/\bcss-\w+/);
  });

  it('records an element the layer rebuilds, one fiber above it', async () => {
    await render(
      emotion.jsxDEV(
        'b',
        { className: 'styled', css: css`color: red` },
        undefined,
        false,
        at(20, 6),
      ),
    );

    /**
     * The boundary, stated rather than smoothed over. Emotion answers a `css`
     * prop by rendering its own component and rebuilding the props with `for…in`,
     * which does not copy symbols — so the host `<b>` arrives with nothing on it
     * and the location lives on the wrapper above.
     *
     * That is the same walk every consumer of provenance already performs, and it
     * still lands on the right line: `createEmotionProps` rebuilds the props, but
     * Emotion forwards the *source argument* untouched, so what this runtime
     * records is the location of the `<b>` and not of the wrapper.
     */
    expect(sourceOf('b.styled')).toEqual({ file: 'src/catalogue.jsx', line: 20, column: 6 });
  });

  it('records an element the layer passes a key through', async () => {
    await render(
      emotion.jsxDEV('ul', {
        className: 'list',
        children: [
          emotion.jsxDEV('li', { className: 'row', key: 'a' }, undefined, false, at(31, 8)),
        ],
      }),
    );

    expect(sourceOf('li.row')).toEqual({ file: 'src/catalogue.jsx', line: 31, column: 8 });
  });

  it('does not put the location in what a snapshot is a hash of', async () => {
    const props = { className: 'badge' };
    const before = propsDigest(props);

    await render(emotion.jsxDEV('span', props, undefined, false, at(12, 4)));

    expect(propsDigest(props)).toBe(before);
  });
});
