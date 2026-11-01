import { promisify } from 'node:util';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { endLoad, realm, startLoad, switchTo, testSession } from './realm.js';
import { nextSession } from './session.js';
import { isolateGlobals } from './globals.js';
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

/** Start over at setup: a realm in which no session has started yet. */
const atSetup = () => {
  delete (globalThis as Record<symbol, unknown>)[REALM];
};

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

  it('leaves a chain the file started to the file, when it reschedules inside a test', () => {
    const { host, pending } = fakeHost();
    onTestFinished(isolateTimers(host));
    const schedule = host.setTimeout as (callback: () => void) => number;
    const tick = () => void schedule(tick);
    schedule(tick);
    const leave = enterTest();
    const [[handle, fire]] = [...pending];
    pending.delete(handle);
    fire!();
    leave();
    expect(pending.size).toBe(1);
    nextSession();
    expect(pending.size).toBe(0);
  });

  it('keeps cancelling after isolateGlobals restores the globals it found first', () => {
    const { host, pending } = fakeHost();
    onTestFinished(isolateGlobals(host));
    onTestFinished(isolateTimers(host));
    nextSession();
    const leave = enterTest();
    (host.setTimeout as (callback: () => void) => number)(() => {});
    leave();
    expect(pending.size).toBe(0);
  });

  it('tells apart handles a browser numbers in separate pools', () => {
    const timers = fakeHost();
    const frames = fakeHost();
    const host = { ...timers.host, requestAnimationFrame: frames.host.setTimeout, cancelAnimationFrame: frames.host.clearTimeout };
    onTestFinished(isolateTimers(host));
    const leave = enterTest();
    (host.setInterval as (callback: () => void) => number)(() => {});
    (host.requestAnimationFrame as (callback: () => void) => number)(() => {});
    const [[handle, frame]] = [...frames.pending];
    frames.pending.delete(handle);
    frame!();
    leave();
    expect(timers.pending.size).toBe(0);
  });

  it('installs nothing on a second call', () => {
    const { host } = fakeHost();
    onTestFinished(isolateTimers(host));
    const wrapped = host.setTimeout;
    onTestFinished(isolateTimers(host));
    expect(host.setTimeout).toBe(wrapped);
  });

  it('keeps what promisify answers for the scheduler it wraps', async () => {
    const host: Record<string, unknown> = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
    onTestFinished(isolateTimers(host));
    const sleep = promisify(host.setTimeout as typeof setTimeout);
    await expect(sleep(1, 'woke')).resolves.toBe('woke');
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

  it('keeps what setup schedules before any session starts', () => {
    atSetup();
    const { host, pending } = fakeHost();
    onTestFinished(isolateTimers(host));
    (host.setInterval as (callback: () => void) => number)(() => {});
    nextSession();
    expect(pending.size).toBe(1);
  });

  it('cancels what a setup or load timer schedules while a test runs, as the test ends', () => {
    atSetup();
    const { host, pending } = fakeHost();
    onTestFinished(isolateTimers(host));
    const schedule = host.setInterval as (callback: () => void) => number;
    schedule(() => void schedule(() => {}));
    nextSession();
    startLoad();
    schedule(() => void schedule(() => {}));
    endLoad();
    const leave = enterTest();
    for (const [, fire] of [...pending]) fire();
    expect(pending.size).toBe(4);
    leave();
    expect(pending.size).toBe(2);
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

  it('runs a timeout that fires within its test, and cancels one that would fire after it', () => {
    vi.useFakeTimers();
    const undo = isolateTimers();
    onTestFinished(() => {
      undo();
      vi.useRealTimers();
    });
    const fired = vi.fn();
    const late = vi.fn();
    const leave = enterTest();
    // The timers are the subject here, on fake time: nothing waits on them.
    setTimeout(fired, 0);
    vi.advanceTimersByTime(1);
    setTimeout(late, 0);
    leave();
    vi.runAllTimers();
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
