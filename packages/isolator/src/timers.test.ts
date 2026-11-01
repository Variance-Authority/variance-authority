import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { endLoad, realm, startLoad, switchTo, testSession } from './realm.js';
import { nextSession } from './session.js';
import { isolateTimers } from './timers.js';

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

/** A host whose scheduling globals are fakes we can count. */
const fakeHost = () => {
  const pending = new Map<number, () => void>();
  let next = 0;
  const schedule = (callback: () => void) => (pending.set(++next, callback), next);
  const cancel = (handle: number) => void pending.delete(handle);
  const host: Record<string, unknown> = {
    setTimeout: schedule,
    clearTimeout: cancel,
    setInterval: schedule,
    clearInterval: cancel,
  };
  return { host, pending };
};

describe('isolateTimers', () => {
  it('cancels what a test scheduled and left pending, as the test ends', () => {
    const { host, pending } = fakeHost();
    onTestFinished(isolateTimers(host));
    const schedule = host.setTimeout as (callback: () => void) => number;
    const kept = schedule(() => {});
    const leave = enterTest();
    schedule(() => {});
    (host.setInterval as (callback: () => void) => number)(() => {});
    leave();
    expect([...pending.keys()]).toEqual([kept]);
    nextSession();
    expect(pending.size).toBe(0);
  });

  it('keeps what a module schedules as it loads', () => {
    const { host, pending } = fakeHost();
    onTestFinished(isolateTimers(host));
    const leave = enterTest();
    startLoad();
    (host.setInterval as (callback: () => void) => number)(() => {});
    endLoad();
    leave();
    nextSession();
    expect(pending.size).toBe(1);
  });

  it('stops tracking a timer that was cleared', () => {
    const { host, pending } = fakeHost();
    onTestFinished(isolateTimers(host));
    const leave = enterTest();
    const handle = (host.setTimeout as (callback: () => void) => number)(() => {});
    (host.clearTimeout as (handle: number) => void)(handle);
    leave();
    expect(pending.size).toBe(0);
  });

  it('runs a real timeout that fires in time, and cancels one that does not', async () => {
    onTestFinished(isolateTimers());
    const fired = vi.fn();
    const late = vi.fn();
    const leave = enterTest();
    setTimeout(fired, 0);
    await new Promise((resolve) => setTimeout(resolve, 5));
    setTimeout(late, 0);
    leave();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(fired).toHaveBeenCalledOnce();
    expect(late).not.toHaveBeenCalled();
  });

  it('puts the globals back when undone', () => {
    const { host } = fakeHost();
    const original = host.setTimeout;
    isolateTimers(host)();
    expect(host.setTimeout).toBe(original);
  });
});
