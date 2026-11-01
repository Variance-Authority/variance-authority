/**
 * Event listeners a session leaves attached. A test that adds a listener to
 * `document` or `window` and never removes it hands it every event of the
 * tests after it, which a fresh page never does. Opt-in, since it wraps
 * `EventTarget.prototype`.
 */

import { realm } from './realm.js';
import { currentSession } from './session.js';

type Listener = NonNullable<Parameters<EventTarget['addEventListener']>[1]>;
type Add = EventTarget['addEventListener'];
type Remove = EventTarget['removeEventListener'];

/** A listener a session left attached, as {@link IsolateListenersOptions.report} is told. */
export interface LeftListener {
  readonly target: EventTarget;
  readonly type: string;
  readonly capture: boolean;
  /** The stack of the call that added it. */
  readonly added: string;
}

export interface IsolateListenersOptions {
  /**
   * Told of every listener a session left attached, once all of them are
   * removed: a suite that wants each one fixed at its source throws from here.
   * Asking keeps the stack of every addition, which costs.
   */
  readonly report?: (left: LeftListener) => void;
}

/** One attached listener; `owned` is its session's set, absent for one added as a module loaded. */
interface Entry extends LeftListener {
  readonly listener: Listener;
  readonly owned: Set<Entry> | undefined;
  /** Detaches what watches for the target dropping it by itself. */
  unwatch?: (() => void) | undefined;
}

/**
 * Remove, as each session ends, every listener it added to an `EventTarget`
 * and did not remove. A listener a rewritten module adds as it loads belongs
 * to no session, as it would be on every fresh page.
 *
 * @returns a function that puts `EventTarget.prototype` back; listeners still attached stay.
 */
export function isolateListeners(options: IsolateListenersOptions = {}): () => void {
  if (typeof EventTarget !== 'function') return () => {};
  const state = realm();
  const prototype = EventTarget.prototype;
  const add = prototype.addEventListener;
  const remove = prototype.removeEventListener;
  const index = new WeakMap<EventTarget, Map<string, Map<Listener, Entry>>>();
  const sessions = new WeakMap<object, Set<Entry>>();
  const forget = (target: EventTarget, key: string, listener: Listener) => {
    const listeners = index.get(target)?.get(key);
    const entry = listeners?.get(listener);
    if (entry === undefined) return;
    listeners!.delete(listener);
    entry.owned?.delete(entry);
    entry.unwatch?.();
  };

  const added: Add = function (this: EventTarget, type, listener, settings) {
    Reflect.apply(add, this, [type, listener, settings]);
    if (listener == null) return;
    const capture = typeof settings === 'boolean' ? settings : settings?.capture === true;
    const key = `${capture}:${type}`;
    let byKey = index.get(this);
    if (byKey === undefined) index.set(this, (byKey = new Map()));
    let listeners = byKey.get(key);
    if (listeners === undefined) byKey.set(key, (listeners = new Map()));
    // Adding what is attached already attaches nothing, whoever added it.
    if (listeners.has(listener)) return;
    let owned: Set<Entry> | undefined;
    if (state.loading === 0) {
      const session = currentSession();
      owned = sessions.get(session);
      if (owned === undefined) sessions.set(session, (owned = new Set()));
    }
    const added = options.report === undefined || owned === undefined ? '' : (new Error().stack ?? '');
    const entry: Entry = { target: this, type, capture, added, listener, owned };
    listeners.set(listener, entry);
    owned?.add(entry);
    if (typeof settings !== 'object') return;
    // What the target drops by itself is no longer anyone's to remove.
    const dropped = () => forget(this, key, listener);
    const { once, signal } = settings;
    if (once === true) Reflect.apply(add, this, [type, dropped, { capture, once: true }]);
    if (signal != null) Reflect.apply(add, signal, ['abort', dropped, { once: true }]);
    if (once === true || signal != null) {
      entry.unwatch = () => {
        if (once === true) Reflect.apply(remove, this, [type, dropped, { capture }]);
        if (signal != null) Reflect.apply(remove, signal, ['abort', dropped]);
      };
    }
  };
  const removed: Remove = function (this: EventTarget, type, listener, settings) {
    Reflect.apply(remove, this, [type, listener, settings]);
    if (listener == null) return;
    const capture = typeof settings === 'boolean' ? settings : settings?.capture === true;
    forget(this, `${capture}:${type}`, listener);
  };
  prototype.addEventListener = added;
  prototype.removeEventListener = removed;

  const switched = (ended: object | undefined) => {
    const owned = ended === undefined ? undefined : sessions.get(ended);
    if (owned === undefined) return;
    sessions.delete(ended!);
    const left = [...owned];
    for (const entry of left) {
      // Node reads `capture` only from an options object.
      Reflect.apply(remove, entry.target, [entry.type, entry.listener, { capture: entry.capture }]);
      forget(entry.target, `${entry.capture}:${entry.type}`, entry.listener);
    }
    if (options.report !== undefined) for (const { target, type, capture, added } of left) options.report({ target, type, capture, added });
  };
  state.switched.add(switched);
  return () => {
    state.switched.delete(switched);
    if (prototype.addEventListener === added) prototype.addEventListener = add;
    if (prototype.removeEventListener === removed) prototype.removeEventListener = remove;
  };
}
