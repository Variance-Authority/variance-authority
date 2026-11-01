/**
 * Event listeners a session leaves attached. A test that adds a listener to
 * `document` or `window` and never removes it hands it every event of the
 * tests after it, which a fresh page never does. Opt-in, since it wraps
 * `EventTarget.prototype`.
 */

import { realm } from './realm.js';
import { currentSession } from './session.js';

type Listener = NonNullable<Parameters<EventTarget["addEventListener"]>[1]>;
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
   * Told of every listener a session left attached, before it is removed: a
   * suite that wants each one fixed at its source throws from here. Asking
   * keeps the stack of every addition, which costs.
   */
  readonly report?: (left: LeftListener) => void;
}

/** One session's listeners: target, then `capture:type`, then each listener with its stack. */
type Attached = Map<EventTarget, Map<string, Map<Listener, string>>>;

/**
 * Remove, as each session ends, every listener it added to any event target
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
  const sessions = new Map<object, Attached>();
  const forget = (target: EventTarget, key: string, listener: Listener) => {
    for (const [session, attached] of sessions) {
      const byKey = attached.get(target);
      const listeners = byKey?.get(key);
      if (listeners?.delete(listener) !== true) continue;
      if (listeners.size === 0) byKey!.delete(key);
      if (byKey!.size === 0) attached.delete(target);
      if (attached.size === 0) sessions.delete(session);
      return;
    }
  };

  const added: Add = function (this: EventTarget, type, listener, settings) {
    Reflect.apply(add, this, [type, listener, settings]);
    if (listener == null || state.loading > 0) return;
    const capture = typeof settings === 'boolean' ? settings : settings?.capture === true;
    const key = `${capture}:${type}`;
    const session = currentSession();
    let attached = sessions.get(session);
    if (attached === undefined) sessions.set(session, (attached = new Map()));
    let byKey = attached.get(this);
    if (byKey === undefined) attached.set(this, (byKey = new Map()));
    let listeners = byKey.get(key);
    if (listeners === undefined) byKey.set(key, (listeners = new Map()));
    if (listeners.has(listener)) return;
    listeners.set(listener, options.report === undefined ? '' : (new Error().stack ?? ''));
    // What the target drops by itself is no longer the session's to remove.
    const dropped = () => forget(this, key, listener);
    if (typeof settings === 'object' && settings.once === true) Reflect.apply(add, this, [type, dropped, { capture, once: true }]);
    if (typeof settings === 'object' && settings.signal !== undefined) Reflect.apply(add, settings.signal, ['abort', dropped, { once: true }]);
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
    const attached = ended === undefined ? undefined : sessions.get(ended);
    if (attached === undefined) return;
    sessions.delete(ended!);
    for (const [target, byKey] of attached) {
      for (const [key, listeners] of byKey) {
        const at = key.indexOf(':');
        const capture = key.slice(0, at) === 'true';
        const type = key.slice(at + 1);
        for (const [listener, stack] of listeners) {
          Reflect.apply(remove, target, [type, listener, { capture }]);
          options.report?.({ target, type, capture, added: stack });
        }
      }
    }
  };
  state.switched.add(switched);
  return () => {
    state.switched.delete(switched);
    if (prototype.addEventListener === added) prototype.addEventListener = add;
    if (prototype.removeEventListener === removed) prototype.removeEventListener = remove;
  };
}
