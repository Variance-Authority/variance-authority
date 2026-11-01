/**
 * Event listeners a session leaves attached. A test that adds a listener to
 * `document` or `window` and never removes it hands it every event of the
 * tests after it, which a fresh page never does. Opt-in, since it wraps
 * `EventTarget.prototype`.
 */

import { installOnce, realm } from './realm.js';
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
  /** What is attached in its place, which runs it under its owner. */
  readonly attached: (this: EventTarget, event: Event) => void;
  readonly owned: Set<Entry> | undefined;
  /** Detaches what watches for its signal to abort. */
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
  return installOnce('listeners', EventTarget.prototype, () => installListeners(options));
}

function installListeners(options: IsolateListenersOptions): () => void {
  const state = realm();
  const prototype = EventTarget.prototype;
  const add = prototype.addEventListener;
  const remove = prototype.removeEventListener;
  const index = new WeakMap<EventTarget, Map<string, Map<Listener, Entry>>>();
  const sessions = new WeakMap<object, Set<Entry>>();
  // Whose listener runs now: what it adds is its adder's, so a listener a file or
  // a load added does not hand what it adds to the test it runs in. `null` is a load's.
  let running: Set<Entry> | null | undefined;
  const find = (target: EventTarget, key: string, listener: Listener) => index.get(target)?.get(key)?.get(listener);
  const forget = (entry: Entry) => {
    index.get(entry.target)?.get(`${entry.capture}:${entry.type}`)?.delete(entry.listener);
    entry.owned?.delete(entry);
    entry.unwatch?.();
  };

  const added: Add = function (this: EventTarget, type, listener, settings) {
    // The target takes `null` for no options, as it takes `undefined`.
    const given = typeof settings === 'object' && settings !== null ? settings : undefined;
    // An aborted signal attaches nothing.
    if (listener == null || given?.signal?.aborted === true) {
      Reflect.apply(add, this, [type, listener, settings]);
      return;
    }
    const capture = typeof settings === 'boolean' ? settings : settings?.capture === true;
    const key = `${capture}:${type}`;
    let byKey = index.get(this);
    if (byKey === undefined) index.set(this, (byKey = new Map()));
    let listeners = byKey.get(key);
    if (listeners === undefined) byKey.set(key, (listeners = new Map()));
    // Adding what is attached already attaches nothing, whoever added it.
    if (listeners.has(listener)) return;
    let owned: Set<Entry> | undefined;
    if (state.loading === 0 && running !== null) {
      owned = running;
      if (owned === undefined) {
        const session = currentSession();
        owned = sessions.get(session);
        if (owned === undefined) sessions.set(session, (owned = new Set()));
      }
    }
    const once = given?.once === true;
    const owner = owned ?? null;
    const entry: Entry = {
      target: this,
      type,
      capture,
      added: options.report === undefined || owned === undefined ? '' : (new Error().stack ?? ''),
      listener,
      attached(event) {
        // The target dropped a `once` listener as it dispatched it.
        if (once) forget(entry);
        const outer = running;
        running = owner;
        try {
          if (typeof listener === 'function') listener.call(this, event);
          else listener.handleEvent(event);
        } finally {
          running = outer;
        }
      },
      owned,
    };
    Reflect.apply(add, this, [type, entry.attached, settings]);
    listeners.set(listener, entry);
    owned?.add(entry);
    const signal = given?.signal;
    if (signal != null) {
      // What the target drops by itself is no longer anyone's to remove.
      const dropped = () => forget(entry);
      Reflect.apply(add, signal, ['abort', dropped, { once: true }]);
      entry.unwatch = () => Reflect.apply(remove, signal, ['abort', dropped]);
    }
  };
  const removed: Remove = function (this: EventTarget, type, listener, settings) {
    const capture = typeof settings === 'boolean' ? settings : settings?.capture === true;
    const entry = listener == null ? undefined : find(this, `${capture}:${type}`, listener);
    if (entry === undefined) {
      Reflect.apply(remove, this, [type, listener, settings]);
      return;
    }
    forget(entry);
    // Node reads `capture` only from an options object.
    Reflect.apply(remove, this, [type, entry.attached, { capture }]);
  };
  prototype.addEventListener = added;
  prototype.removeEventListener = removed;

  const switched = (ended: object | undefined) => {
    const owned = ended === undefined ? undefined : sessions.get(ended);
    if (owned === undefined) return;
    sessions.delete(ended!);
    const left = [...owned];
    for (const entry of left) {
      forget(entry);
      Reflect.apply(remove, entry.target, [entry.type, entry.attached, { capture: entry.capture }]);
    }
    if (options.report === undefined) return;
    // Every leftover is told, even when telling one throws.
    const failures: unknown[] = [];
    for (const { target, type, capture, added } of left) {
      try {
        options.report({ target, type, capture, added });
      } catch (failure) {
        failures.push(failure);
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, 'the ended session left more than one listener');
  };
  state.switched.add(switched);
  return () => {
    state.switched.delete(switched);
    if (prototype.addEventListener === added) prototype.addEventListener = add;
    if (prototype.removeEventListener === removed) prototype.removeEventListener = remove;
  };
}
