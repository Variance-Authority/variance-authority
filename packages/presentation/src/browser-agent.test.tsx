// @vitest-environment jsdom
//
// Real React and a real Suspense boundary: the agent's claim is that it agrees
// with React about whether the subject has arrived.

import { Suspense, act, createElement as h, use } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { acquirePresentation } from './browser-agent.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

function Late({ promise }: { promise: Promise<string> }) {
  return h('span', null, use(promise));
}

describe('acquirePresentation', () => {
  it('refuses a subject whose Suspense boundary has not resolved, naming it', async () => {
    const never = new Promise<string>(() => {});
    await act(async () => {
      root.render(
        h('nav', { 'aria-label': 'Primary' },
          h(Suspense, { fallback: h('span', null, 'Loading') }, h(Late, { promise: never }))),
      );
    });
    const subject = container.querySelector('nav');
    if (subject === null) throw new Error('the subject did not mount');

    await expect(acquirePresentation(subject, {
      subject: { id: 'primary-nav', selector: 'nav' },
      viewport: { width: 800, height: 600, deviceScaleFactor: 1 },
      engine: 'chromium',
      // The bound is already spent, so the one read decides.
      suspense: { timeoutMs: 0 },
    } as never)).rejects.toThrow(/primary-nav.*was still waiting.*1 Suspense boundary/s);
  });
});
