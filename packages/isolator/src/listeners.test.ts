import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { isolateListeners, type LeftListener } from './listeners.js';
import { endLoad, realm, startLoad, switchTo, testSession } from './realm.js';
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

describe('isolateListeners', () => {
  it('removes what a test added and left attached, as the test ends', () => {
    onTestFinished(isolateListeners());
    const target = new EventTarget();
    const file = vi.fn();
    const test = vi.fn();
    target.addEventListener('ping', file);
    const leave = enterTest();
    target.addEventListener('ping', test, { capture: true });
    leave();
    target.dispatchEvent(new Event('ping'));
    expect(file).toHaveBeenCalledOnce();
    expect(test).not.toHaveBeenCalled();
    nextSession();
    target.dispatchEvent(new Event('ping'));
    expect(file).toHaveBeenCalledOnce();
  });

  it('keeps what a module adds as it loads', () => {
    onTestFinished(isolateListeners());
    const target = new EventTarget();
    const loaded = vi.fn();
    const leave = enterTest();
    startLoad();
    target.addEventListener('ping', loaded);
    endLoad();
    leave();
    target.dispatchEvent(new Event('ping'));
    expect(loaded).toHaveBeenCalledOnce();
  });

  it('reports only what is still attached, with where it was added', () => {
    const report = vi.fn<(left: LeftListener) => void>();
    onTestFinished(isolateListeners({ report }));
    const target = new EventTarget();
    const removed = () => {};
    const leave = enterTest();
    target.addEventListener('removed', removed);
    target.removeEventListener('removed', removed);
    target.addEventListener('once', () => {}, { once: true });
    target.dispatchEvent(new Event('once'));
    const controller = new AbortController();
    target.addEventListener('aborted', () => {}, { signal: controller.signal });
    controller.abort();
    target.addEventListener('left', () => {});
    leave();
    expect(report).toHaveBeenCalledOnce();
    expect(report.mock.calls[0]![0]).toMatchObject({ target, type: 'left', capture: false });
    expect(report.mock.calls[0]![0].added).toContain('listeners.test.ts');
  });

  it('puts the prototype back when undone', () => {
    const add = EventTarget.prototype.addEventListener;
    isolateListeners()();
    expect(EventTarget.prototype.addEventListener).toBe(add);
  });
});
