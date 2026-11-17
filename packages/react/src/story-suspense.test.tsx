// @vitest-environment jsdom
import { Suspense, act, createElement as h, use } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { watchSuspense } from './story-suspense.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

// What the story was told, in the order it was told: the watch's notes, and the test's own.
let said: string[];
let stop: () => void;

beforeEach(() => {
  said = [];
  stop = watchSuspense(document, (text) => said.push(text));
  container = document.body.appendChild(document.createElement('div'));
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  stop();
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

describe('what the Suspense boundaries on the page did, as they did it', () => {
  it('tells a boundary showing its fallback and unlocking where each happened, between what else was told', async () => {
    const cart = deferred();
    said.push('page created');
    await render(h(Cart, { promise: cart.promise }));
    said.push('GET /cart 200');
    await cart.settle();
    said.push('clicked Pay');

    expect(said).toEqual([
      'page created',
      'suspense Cart › Suspense shows its fallback',
      'GET /cart 200',
      'suspense Cart › Suspense unlocks',
      'clicked Pay',
    ]);
  });

  it('tells each boundary on its own, in the order they changed', async () => {
    const cart = deferred();
    const reviews = deferred();
    await render(h('main', null, h(Cart, { promise: cart.promise }), h(Reviews, { promise: reviews.promise })));
    await reviews.settle();
    await cart.settle();

    expect(said).toEqual([
      'suspense Cart › Suspense shows its fallback',
      'suspense Reviews › Suspense shows its fallback',
      'suspense Reviews › Suspense unlocks',
      'suspense Cart › Suspense unlocks',
    ]);
  });

  it('tells a boundary that falls back again each time it does', async () => {
    const first = deferred();
    await render(h(Cart, { promise: first.promise }));
    await first.settle();
    const second = deferred();
    await render(h(Cart, { promise: second.promise }));
    await second.settle();

    expect(said).toEqual([
      'suspense Cart › Suspense shows its fallback',
      'suspense Cart › Suspense unlocks',
      'suspense Cart › Suspense shows its fallback',
      'suspense Cart › Suspense unlocks',
    ]);
  });

  it('tells nothing of a boundary that never fell back', async () => {
    await render(h(Suspense, { fallback: 'loading' }, h('span', null, 'ready')));

    expect(said).toEqual([]);
  });

  it('calls a boundary taken off the page while falling back neither unlocked nor anything else', async () => {
    await render(h(Cart, { promise: deferred().promise }));
    await render(null);

    expect(said).toEqual(['suspense Cart › Suspense shows its fallback']);
  });

  it('names a boundary by the component that wrote it, not the one it was handed to', async () => {
    const cart = deferred();
    function Layout({ children }: { children: unknown }) {
      return h('section', null, children as never);
    }
    function Page() {
      return h(Layout, null, h(Suspense, { fallback: 'loading' }, h(Late, { promise: cart.promise })));
    }
    await render(h(Page));

    expect(said).toEqual(['suspense Page › Suspense shows its fallback']);
  });

  it('tells apart two boundaries of one writer, one unlocking as the other falls back', async () => {
    const first = deferred();
    await render(h('main', null, h(Cart, { key: 'a', promise: first.promise })));
    await first.settle();
    await render(h('main', null, h(Cart, { key: 'a', promise: first.promise }), h(Cart, { key: 'b', promise: deferred().promise })));

    expect(said).toEqual([
      'suspense Cart › Suspense shows its fallback',
      'suspense Cart › Suspense unlocks',
      'suspense Cart › Suspense shows its fallback',
    ]);
  });

  it('reads a root mounted at the document itself', async () => {
    const cart = deferred();
    const whole = createRoot(document);
    try {
      await act(async () => whole.render(h('html', null, h('body', null, h(Cart, { promise: cart.promise })))));
      await cart.settle();
      expect(said).toEqual(['suspense Cart › Suspense shows its fallback', 'suspense Cart › Suspense unlocks']);
    } finally {
      await act(async () => whole.unmount());
    }
  });

  it('tells nothing once stopped', async () => {
    stop();
    await render(h(Cart, { promise: deferred().promise }));

    expect(said).toEqual([]);
  });
});
