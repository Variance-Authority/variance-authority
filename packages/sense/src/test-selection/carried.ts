/**
 * What a document a navigation replaced entered, handed to the document that
 * replaced it.
 *
 * A runner reads nothing of a document once its navigation started: Chromium
 * destroys the context an evaluation sent then would run in. So the collector
 * drains itself as the document goes, into its frame's session storage, and the
 * collector of the next document of the same origin in that frame, and no later
 * one, lays it in front of its own first drain. The drain says how many
 * documents it carries, so a runner that counted the frame's documents knows
 * whether any was lost on the way: one of another origin, or one that had no
 * collector.
 *
 * A frame is named by its place under the top one. A document the browser keeps
 * to come back to is not drained: it is still there to be drained.
 */

/**
 * Source that defines `carry`, for the collector to evaluate where `drain` and
 * `realm` are in scope. `carry.take()` is the journal the replaced document left,
 * once; `carry.forget()` drops it.
 */
export const CARRIED_SOURCE = `
const carry = (() => {
  const key = (() => {
    let place = '';
    try {
      for (let frame = realm; frame !== frame.parent; frame = frame.parent) {
        place = Array.prototype.indexOf.call(frame.parent.frames, frame) + '.' + place;
      }
    } catch {
      // A frame whose parent hides its place carries nothing.
      return undefined;
    }
    return 'variance-authority.carried:' + place;
  })();
  let left;
  try {
    const kept = key === undefined ? null : realm.sessionStorage.getItem(key);
    if (kept !== null) {
      realm.sessionStorage.removeItem(key);
      const { at, journal } = JSON.parse(kept);
      // Left by a document before the one this realm replaced: not this frame's.
      if (at >= realm.performance.timeOrigin) left = journal;
    }
  } catch {
    // A document without storage, an opaque origin's, carries nothing.
  }
  if (key !== undefined && typeof realm.addEventListener === 'function') {
    realm.addEventListener('pagehide', (event) => {
      if (event.persisted) return;
      try {
        const at = realm.performance.timeOrigin + realm.performance.now();
        realm.sessionStorage.setItem(key, JSON.stringify({ at, journal: drain() }));
      } catch {
        // Storage full or refused: the runner counts the document lost.
      }
    });
  }
  return {
    take() {
      const journal = left;
      left = undefined;
      return journal;
    },
    story() {
      const story = left?.story;
      if (left !== undefined) delete left.story;
      return story;
    },
    forget() {
      left = undefined;
    },
  };
})();
const joined = (before, own) => {
  const byId = new Map();
  for (const modules of [before, own]) {
    for (const entry of modules) {
      let into = byId.get(entry.id);
      if (into === undefined) byId.set(entry.id, (into = { id: entry.id, hits: new Set(), shared: new Set(), again: new Set() }));
      for (const field of ['hits', 'shared', 'again']) for (const ordinal of entry[field] ?? []) into[field].add(ordinal);
    }
  }
  const sorted = (ordinals) => [...ordinals].sort((left, right) => left - right);
  return [...byId.values()].map(({ id, hits, shared, again }) => ({ id, hits: sorted(hits), shared: sorted(shared), again: sorted(again) }));
};
`;
