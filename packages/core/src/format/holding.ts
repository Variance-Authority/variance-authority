import type { Digest } from './hash.js';

/**
 * Holding: what a component was holding, as distinct from how it is attached.
 *
 * {@link Wiring} ends on the sentence that defines this type by exclusion —
 * *wiring carries the shape of the component's attachment and nothing that
 * attachment happened to be holding*. This is the nothing. A `useState` cell's
 * value, a `useSyncExternalStore` snapshot, a context's current value, and the
 * per-key breakdown of the props object a boundary was handed.
 *
 * ## Why the refusal in `Wiring` is not reversed here
 *
 * `Wiring` states, correctly, that state values must never be a band: a hook's
 * value is the thing that *legitimately* differs between two readings of one
 * page — the ticker, the timestamp, the animation frame — so a band carrying one
 * would be a flake generator wearing a band's name. That argument is about
 * **identity**, and it is accepted here without qualification.
 *
 * This type is not identity. It is **evidence**, and it enters no hash: not the
 * render hash, not the structure or style hash, not a component hash, not an
 * environment key. Its precedent is `styleProvenance`, which exists for the same
 * reason and takes the same exemption — normalization discards exactly what
 * attribution needs, so the discarded thing is preserved beside the snapshot
 * rather than inside it. Keeping it outside is the point, twice over: a baseline
 * cannot be invalidated by a value that was always allowed to move, and a
 * differ that could not read *why* a component chose differently is left
 * reporting the choice.
 *
 * The two types therefore answer different questions about one boundary, and the
 * pair is what makes the interesting sentence sayable:
 *
 * | question | answered by |
 * |---|---|
 * | is this the same component? | `Wiring` — hook shape, wrappers, contexts, key |
 * | did it decide the same way? | `Holding` — the values those hooks were holding |
 *
 * ## Digests, never values
 *
 * Every field is a {@link Digest}, on spec 0024's rule and for its reason: a
 * prop value can be a customer record, and a `useState` cell can hold the same
 * record with a session token beside it. The digest is what makes an equality
 * comparison possible without the value leaving the page. Nothing here can be
 * reversed into what a user was looking at, which is the property that lets this
 * travel over the same wire the rest of the document does.
 *
 * The cost is the one `propsDigest` already documents and accepts: shape rather
 * than identity, so a re-created closure does not register and a genuinely
 * rebound anonymous one does not either. That is tolerable for the same reason —
 * this decides *who is responsible* for a difference the semantic diff already
 * found, never *whether* there is one.
 */
export interface Holding {
  /**
   * One digest per hook that retains something, in authored call order.
   *
   * Sparse by construction. A hook that retains nothing a later reading could
   * disagree about contributes no cell, so `useContext` (which has no cell at
   * all) and the dispatch half of `useActionState` (a function React rebuilds)
   * are absent rather than present-and-meaningless. {@link HeldCell.index}
   * carries the authored position, so a gap is legible instead of silently
   * renumbering everything after it.
   */
  readonly cells?: readonly HeldCell[];

  /**
   * Context values this boundary read, by the context's display name, sorted.
   *
   * Separate from `cells` because a context subscription leaves no hook cell —
   * it is recorded on the fiber's dependency list and nowhere else — and because
   * the two fail differently. A changed cell is this component's own decision; a
   * changed context is a decision taken above it by a provider that may not even
   * be in the subject, which is a different sentence and a different fix.
   */
  readonly contexts?: readonly HeldValue[];

  /**
   * The props object, one digest per key, sorted — spec 0024's map.
   *
   * `OwnerFrame.propsDigest` says *this component was handed something
   * different* and cannot say which thing. This says which thing, under the same
   * projection and with `children` excluded for the same reason: `children` *is*
   * the subtree, and digesting it would make every ancestor's inputs a function
   * of every descendant's edit, which is the condition that makes root
   * attribution work at all.
   */
  readonly props?: readonly HeldValue[];

  /**
   * The hook whose name this reader does not know, when one was met.
   *
   * Present only on a truncated read, and its presence means `cells` is a
   * *prefix* rather than the whole list. Alignment between React's recorded hook
   * names and its hook cells depends on knowing how many cells each hook builds
   * (see the reader's table), so one unrecognised name makes every cell after it
   * unattributable — not wrong by a little, but attached to the wrong hook.
   *
   * Reported rather than guessed through, on ADR-0002: a prefix that says where
   * it stopped is usable, and a full list silently mislabelled from the fourth
   * entry on is the failure this project exists to refuse. The reader stops, and
   * a React release that adds a hook makes this field appear instead of making
   * an attribution quietly point at the wrong `useState`.
   */
  readonly unread?: string;
}

/** One hook cell's retained value, addressed by the position a person can count to. */
export interface HeldCell {
  /**
   * Position in the component's own hook call order, zero-based.
   *
   * The number a reader arrives at by counting hook calls down the component,
   * which is the only index anybody can act on — it indexes
   * {@link Wiring.hooks} exactly, and it is *not* an index into React's cell
   * chain, because `useContext` builds no cell and `useTransition` builds two.
   * Converting between the two is the reader's job and the reason it needs a
   * measured table rather than a zip.
   */
  readonly index: number;

  /** `useState`, `useReducer`, `useSyncExternalStore`, … as React recorded it. */
  readonly hook: string;

  /**
   * Digest of what the cell held, under a projection chosen per hook.
   *
   * Per hook because the cells are not alike and a single rule over them is
   * either useless or fatal. A `useState` cell holds the state; a `useMemo` cell
   * holds `[value, deps]` and the deps are the input the value is derived from;
   * an effect cell holds an object whose `next` pointer closes a ring, and
   * walking one is an out-of-memory kill rather than a bad digest. The reader
   * names the projection it used for each.
   */
  readonly digest: Digest;
}

/** A named value a boundary read: a context, or one prop. */
export interface HeldValue {
  readonly name: string;
  readonly digest: Digest;
}
