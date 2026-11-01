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
    target.addEventListener('signalled', () => {}, { signal: controller.signal });
    target.addEventListener('left', () => {});
    leave();
    expect(report).toHaveBeenCalledOnce();
    expect(report.mock.calls[0]![0]).toMatchObject({ target, type: 'left', capture: false });
    expect(report.mock.calls[0]![0].added).toContain('listeners.test.ts');
  });

  it('keeps a listener a module added as it loaded, when a test adds it again', () => {
    onTestFinished(isolateListeners());
    const target = new EventTarget();
    const loaded = vi.fn();
    startLoad();
    target.addEventListener('ping', loaded);
    endLoad();
    const leave = enterTest();
    target.addEventListener('ping', loaded);
    leave();
    target.dispatchEvent(new Event('ping'));
    expect(loaded).toHaveBeenCalledOnce();
  });

  it('removes every listener left, tells each one, and still ends the session, when report throws', () => {
    const others = vi.fn();
    realm().switched.add(others);
    onTestFinished(() => void realm().switched.delete(others));
    onTestFinished(
      isolateListeners({
        report: ({ type }) => {
          throw new Error(`left ${type}`);
        },
      }),
    );
    const target = new EventTarget();
    const first = vi.fn();
    const second = vi.fn();
    const leave = enterTest();
    target.addEventListener('first', first);
    target.addEventListener('second', second);
    let thrown: unknown;
    try {
      leave();
    } catch (failure) {
      thrown = failure;
    }
    expect((thrown as AggregateError).errors.map((error: Error) => error.message)).toEqual(['left first', 'left second']);
    target.dispatchEvent(new Event('first'));
    target.dispatchEvent(new Event('second'));
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    expect(others).toHaveBeenCalled();
  });

  it('keeps what a listener the file added adds while a test runs, and leaves it to the file', () => {
    onTestFinished(isolateListeners());
    const target = new EventTarget();
    const chained = vi.fn();
    target.addEventListener('ping', () => target.addEventListener('chained', chained), { once: true });
    const leave = enterTest();
    target.dispatchEvent(new Event('ping'));
    leave();
    target.dispatchEvent(new Event('chained'));
    expect(chained).toHaveBeenCalledOnce();
    nextSession();
    target.dispatchEvent(new Event('chained'));
    expect(chained).toHaveBeenCalledOnce();
  });

  it('reports no once listener the target dropped, even one that stopped the event', () => {
    const report = vi.fn<(left: LeftListener) => void>();
    onTestFinished(isolateListeners({ report }));
    const target = new EventTarget();
    const leave = enterTest();
    target.addEventListener('ping', (event) => event.stopImmediatePropagation(), { once: true });
    target.dispatchEvent(new Event('ping'));
    leave();
    expect(report).not.toHaveBeenCalled();
  });

  it('installs nothing on a second call', () => {
    onTestFinished(isolateListeners());
    const wrapped = EventTarget.prototype.addEventListener;
    onTestFinished(isolateListeners());
    expect(EventTarget.prototype.addEventListener).toBe(wrapped);
  });

  it('puts the prototype back when undone', () => {
    const add = EventTarget.prototype.addEventListener;
    isolateListeners()();
    expect(EventTarget.prototype.addEventListener).toBe(add);
  });
});
