// @vitest-environment jsdom
import { Suspense, act, createElement as h, use } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lineReader } from './story-suspense.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.body.appendChild(document.createElement('div'));
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

/** A promise the test settles by hand, so an open boundary is a state it holds. */
function deferred(): { promise: Promise<string>; settle: () => Promise<void> } {
  let resolve!: (value: string) => void;
  const promise = new Promise<string>((resolveWith) => (resolve = resolveWith));
  return { promise, settle: () => act(async () => resolve('arrived')) };
}

function Late({ promise }: { promise: Promise<string> }) {
  return h('span', null, use(promise));
}

function Cart({ promise }: { promise: Promise<string> }) {
  return h(Suspense, { fallback: 'loading' }, h(Late, { promise }));
}

function Reviews({ promise }: { promise: Promise<string> }) {
  return h(Suspense, { fallback: 'loading' }, h(Late, { promise }));
}

const render = (element: unknown): Promise<void> => act(async () => root.render(element as never));

describe('what a line did to the Suspense boundaries on the page', () => {
  it('names a boundary the line opened, the line its promise settled on, and nothing for a line between', async () => {
    const line = lineReader();
    const cart = deferred();
    expect(line()).toBeUndefined();

    await render(h(Cart, { promise: cart.promise }));
    expect(line()).toBe('suspense 1 opened, 1 still open: Cart › Suspense');
    expect(line()).toBeUndefined();

    await cart.settle();
    expect(line()).toBe('suspense 1 resolved');
    expect(line()).toBeUndefined();
  });

  it('counts each boundary, and names those still open in tree order', async () => {
    const line = lineReader();
    const cart = deferred();
    const reviews = deferred();

    await render(h('main', null, h(Cart, { promise: cart.promise }), h(Reviews, { promise: reviews.promise })));
    expect(line()).toBe('suspense 2 opened, 2 still open: Cart › Suspense; Reviews › Suspense');

    await cart.settle();
    expect(line()).toBe('suspense 1 resolved, 1 still open: Reviews › Suspense');
  });

  it('calls an open boundary that was taken off the page neither resolved nor open', async () => {
    const line = lineReader();
    await render(h(Cart, { promise: deferred().promise }));
    line();

    await render(null);
    expect(line()).toBeUndefined();
  });

  it('names a boundary by the component that wrote it, not the one it was handed to', async () => {
    const line = lineReader();
    const cart = deferred();
    function Layout({ children }: { children: unknown }) {
      return h('section', null, children as never);
    }
    function Page() {
      return h(Layout, null, h(Suspense, { fallback: 'loading' }, h(Late, { promise: cart.promise })));
    }
    await render(h(Page));
    expect(line()).toBe('suspense 1 opened, 1 still open: Page › Suspense');
  });

  it('calls a boundary swapped for one already showing its content neither resolved nor open', async () => {
    const line = lineReader();
    await render(h('main', null, h(Cart, { key: 'a', promise: deferred().promise })));
    line();

    const shown = deferred();
    await shown.settle();
    await render(h('main', null, h(Cart, { key: 'b', promise: shown.promise })));
    expect(line()).toBeUndefined();
  });

  it('tells apart two boundaries of one writer, one resolving as the other opens', async () => {
    const line = lineReader();
    const first = deferred();
    await render(h('main', null, h(Cart, { key: 'a', promise: first.promise })));
    line();

    await first.settle();
    await render(h('main', null, h(Cart, { key: 'a', promise: first.promise }), h(Cart, { key: 'b', promise: deferred().promise })));
    expect(line()).toBe('suspense 1 opened, 1 resolved, 1 still open: Cart › Suspense');
  });

  it('says on the last line which boundaries were still open, though it changed none', async () => {
    const line = lineReader();
    await render(h(Cart, { promise: deferred().promise }));
    line();

    expect(line({ last: false })).toBeUndefined();
    expect(line({ last: true })).toBe('suspense 1 still open at the end: Cart › Suspense');
  });

  it('says nothing on a last line with nothing open', async () => {
    const line = lineReader();
    const cart = deferred();
    await render(h(Cart, { promise: cart.promise }));
    line();
    await cart.settle();

    expect(line({ last: true })).toBe('suspense 1 resolved');
    expect(line({ last: true })).toBeUndefined();
  });

  it('says nothing where nothing has suspended', () => {
    expect(lineReader()()).toBeUndefined();
  });
});
