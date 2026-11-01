/**
 * Timers a session leaves running. A test that schedules a callback and ends
 * before it fires hands the callback to the next test, which a fresh file
 * never sees. Opt-in, since it wraps the globals.
 */

import { inEverySession, installOnce, realm } from './realm.js';
import { currentSession } from './session.js';

/**
 * A scheduling global, the global that cancels what it returns, whether it
 * fires once, and the pool its handles are numbered in: a browser numbers
 * timeouts and intervals together and animation frames apart, so a frame and
 * an interval can share a number.
 */
const PAIRS = [
  ['setTimeout', 'clearTimeout', true, 'timer'],
  ['setInterval', 'clearInterval', false, 'timer'],
  ['setImmediate', 'clearImmediate', true, 'immediate'],
  ['requestAnimationFrame', 'cancelAnimationFrame', true, 'frame'],
] as const;

type Scheduler = (callback: (...args: unknown[]) => void, ...rest: unknown[]) => unknown;
type Canceller = (handle: unknown) => void;

/** A timer still pending, with the set of its owner's pending timers. */
interface Pending {
  readonly handle: unknown;
  readonly clear: Canceller;
  readonly pool: string;
  readonly owner: Set<Pending>;
}

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
  return installOnce('timers', target, () => installTimers(target));
}

function installTimers(target: Record<string, unknown>): () => void {
  const state = realm();
  // What each session has pending, and each pending timer by its pool and handle.
  const pending = new WeakMap<object, Set<Pending>>();
  const pools = new Map<string, Map<unknown, Pending>>();
  const forget = (timer: Pending | undefined) => {
    if (timer === undefined) return;
    timer.owner.delete(timer);
    pools.get(timer.pool)?.delete(timer.handle);
  };
  // Whose callback runs now: what it schedules is its scheduler's, so a chain a
  // file or a load started is not taken by the test it fires in. `null` is a load's.
  let running: Set<Pending> | null | undefined;
  const undo: (() => void)[] = [];
  for (const [schedule, cancel, once, pool] of PAIRS) {
    const original = target[schedule] as Scheduler | undefined;
    const originalCancel = target[cancel] as Canceller | undefined;
    if (typeof original !== 'function' || typeof originalCancel !== 'function') continue;
    const handles = pools.get(pool) ?? new Map<unknown, Pending>();
    pools.set(pool, handles);
    const clear: Canceller = (handle) => originalCancel.call(target, handle);
    function scheduled(this: unknown, callback: (...args: unknown[]) => void, ...rest: unknown[]): unknown {
      if (typeof callback !== 'function') return Reflect.apply(original!, this, [callback, ...rest]);
      let owner: Set<Pending> | null;
      if (state.loading > 0 || running === null) owner = null;
      else if (running !== undefined) owner = running;
      else {
        const session = currentSession();
        if (inEverySession(session)) owner = null;
        else {
          owner = pending.get(session) ?? null;
          if (owner === null) pending.set(session, (owner = new Set()));
        }
      }
      let timer: Pending | undefined;
      const handle: unknown = Reflect.apply(original!, this, [
        function (this: unknown, ...args: unknown[]) {
          if (once) forget(timer);
          const outer = running;
          running = owner;
          try {
            return Reflect.apply(callback, this, args);
          } finally {
            running = outer;
          }
        },
        ...rest,
      ]);
      if (owner !== null) {
        timer = { handle, clear, pool, owner };
        owner.add(timer);
        handles.set(handle, timer);
      }
      return handle;
    }
    function cancelled(this: unknown, handle: unknown): void {
      forget(handles.get(handle));
      Reflect.apply(originalCancel!, this, [handle]);
    }
    // What the original carries beyond a function's own, such as Node's
    // `util.promisify.custom`, answers for the wrapper too.
    carry(original, scheduled);
    carry(originalCancel, cancelled);
    target[schedule] = scheduled;
    target[cancel] = cancelled;
    undo.push(() => {
      if (target[schedule] === scheduled) target[schedule] = original;
      if (target[cancel] === cancelled) target[cancel] = originalCancel;
    });
  }
  const switched = (ended: object | undefined) => {
    const timers = ended === undefined ? undefined : pending.get(ended);
    if (timers === undefined) return;
    pending.delete(ended!);
    for (const timer of timers) {
      pools.get(timer.pool)?.delete(timer.handle);
      timer.clear(timer.handle);
    }
    timers.clear();
  };
  state.switched.add(switched);
  return () => {
    state.switched.delete(switched);
    for (const step of undo) step();
  };
}

function carry(from: object, to: object): void {
  for (const key of Reflect.ownKeys(from)) {
    if (!Object.hasOwn(to, key)) Reflect.defineProperty(to, key, Reflect.getOwnPropertyDescriptor(from, key)!);
  }
}
