/**
 * Timers a session leaves running. A test that schedules a callback and ends
 * before it fires hands the callback to the next test, which a fresh file
 * never sees. Opt-in, since it wraps the globals.
 */

import { installOnce, realm } from './realm.js';
import { currentSession } from './session.js';

/** A scheduling global and the global that cancels what it returns. */
const PAIRS = [
  ['setTimeout', 'clearTimeout', true],
  ['setInterval', 'clearInterval', false],
  ['setImmediate', 'clearImmediate', true],
  ['requestAnimationFrame', 'cancelAnimationFrame', true],
] as const;

type Scheduler = (callback: (...args: unknown[]) => void, ...rest: unknown[]) => unknown;
type Canceller = (handle: unknown) => void;

/**
 * Cancel, as each session ends, every timer it scheduled that is still
 * pending: `setTimeout`, `setInterval`, `setImmediate` and, where the global
 * exists, `requestAnimationFrame`. A timer a rewritten module schedules as it
 * loads belongs to no session, as it would run on every fresh page. Promises
 * and `queueMicrotask` cannot be cancelled and are left alone.
 *
 * @returns a function that puts the globals back; timers still pending stay.
 */
export function isolateTimers(target: Record<string, unknown> = globalThis as never): () => void {
  return installOnce(target.setTimeout as object, () => installTimers(target));
}

function installTimers(target: Record<string, unknown>): () => void {
  const state = realm();
  const pending = new WeakMap<object, Map<unknown, Canceller>>();
  // Each pending handle, with its session's handles: a session nothing ends holds nothing.
  const owners = new Map<unknown, Map<unknown, Canceller>>();
  const forget = (handle: unknown) => {
    owners.get(handle)?.delete(handle);
    owners.delete(handle);
  };
  const undo: (() => void)[] = [];
  for (const [schedule, cancel, once] of PAIRS) {
    const original = target[schedule] as Scheduler | undefined;
    const originalCancel = target[cancel] as Canceller | undefined;
    if (typeof original !== 'function' || typeof originalCancel !== 'function') continue;
    const clear: Canceller = (handle) => originalCancel.call(target, handle);
    function scheduled(this: unknown, callback: (...args: unknown[]) => void, ...rest: unknown[]): unknown {
      if (typeof callback !== 'function' || state.loading > 0) return Reflect.apply(original!, this, [callback, ...rest]);
      const session = currentSession();
      const handle: unknown = Reflect.apply(original!, this, [
        once
          ? function (this: unknown, ...args: unknown[]) {
              forget(handle);
              return Reflect.apply(callback, this, args);
            }
          : callback,
        ...rest,
      ]);
      let handles = pending.get(session);
      if (handles === undefined) pending.set(session, (handles = new Map()));
      handles.set(handle, clear);
      owners.set(handle, handles);
      return handle;
    }
    function cancelled(this: unknown, handle: unknown): void {
      forget(handle);
      Reflect.apply(originalCancel!, this, [handle]);
    }
    target[schedule] = scheduled;
    target[cancel] = cancelled;
    undo.push(() => {
      if (target[schedule] === scheduled) target[schedule] = original;
      if (target[cancel] === cancelled) target[cancel] = originalCancel;
    });
  }
  const switched = (ended: object | undefined) => {
    const handles = ended === undefined ? undefined : pending.get(ended);
    if (handles === undefined) return;
    pending.delete(ended!);
    for (const [handle, clear] of handles) {
      owners.delete(handle);
      clear(handle);
    }
  };
  state.switched.add(switched);
  return () => {
    state.switched.delete(switched);
    for (const step of undo) step();
  };
}
