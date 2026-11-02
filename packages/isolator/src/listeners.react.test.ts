// @vitest-environment jsdom
//
// React adds its listeners to a container the first time it renders there and
// marks the container, never adding them again: what it adds belongs to no test.

import { createElement } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { beforeEach, expect, it, onTestFinished, vi } from 'vitest';
import { isolateListeners } from './listeners.js';
import { realm, switchTo, testSession } from './realm.js';
import { nextSession } from './session.js';

const REALM = Symbol.for('@variance-authority/isolator');

beforeEach(() => {
  const host = globalThis as Record<symbol, unknown>;
  const kept = host[REALM];
  delete host[REALM];
  onTestFinished(() => {
    host[REALM] = kept;
  });
  nextSession();
});

/** Enter a test of the current file, as ioc's driver does; the returned function leaves it. */
const enterTest = (): (() => void) => {
  const session = testSession();
  switchTo(session, undefined);
  return () => switchTo(realm().file, session);
};

it('keeps the listeners React adds to a portal container, so the next test portal there still answers', () => {
  onTestFinished(isolateListeners());
  const clicked = vi.fn();
  for (const label of ['first', 'second']) {
    const leave = enterTest();
    const container = document.body.appendChild(document.createElement('div'));
    const root = createRoot(container);
    const button = createElement('button', { onClick: () => clicked(label) }, label);
    flushSync(() => root.render(createPortal(button, document.body)));
    document.body.querySelector('button')!.click();
    flushSync(() => root.unmount());
    container.remove();
    leave();
  }
  expect(clicked.mock.calls).toEqual([['first'], ['second']]);
});

it('removes a listener the test adds itself, beside the ones React keeps', () => {
  onTestFinished(isolateListeners());
  const listener = vi.fn();
  const leave = enterTest();
  document.addEventListener('click', listener);
  leave();
  document.body.click();
  expect(listener).not.toHaveBeenCalled();
});
