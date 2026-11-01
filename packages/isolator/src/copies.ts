/**
 * One copy of some state per session, made on first touch: a test's session
 * copies its file's, which copies the base. The frame of a module and a
 * per-session object both keep their copies here.
 */

import { parentSession } from './realm.js';

/** The copies of one piece of state, by session. */
export interface Copies<C extends object> {
  /** The session's copy, made from its parent's, or from the base, when it has none yet. */
  of(session: object): C;
  /** The nearest copy the session or a session it starts from already holds. */
  nearest(session: object): C | undefined;
  /** Every copy a session still holds, for a write that lands in all of them. */
  live(): C[];
}

/** `make(from)` copies `from` for a new session. */
export function copies<C extends object>(base: C, make: (from: C) => C): Copies<C> {
  const bySession = new WeakMap<object, C>();
  const live = new Set<WeakRef<C>>();
  let sweepAt = 64;
  const sweep = () => {
    for (const ref of live) if (ref.deref() === undefined) live.delete(ref);
  };
  const of = (session: object): C => {
    let copy = bySession.get(session);
    if (copy === undefined) {
      const parent = parentSession(session);
      bySession.set(session, (copy = make(parent === undefined ? base : of(parent))));
      live.add(new WeakRef(copy));
      // A session that ended leaves its reference behind: drop them as they pile up.
      if (live.size > sweepAt) {
        sweep();
        sweepAt = Math.max(64, live.size * 2);
      }
    }
    return copy;
  };
  const nearest = (session: object): C | undefined => {
    const copy = bySession.get(session);
    if (copy !== undefined) return copy;
    const parent = parentSession(session);
    return parent === undefined ? undefined : nearest(parent);
  };
  return {
    of,
    nearest,
    live() {
      sweep();
      return [...live].map((ref) => ref.deref()!);
    },
  };
}
