/**
 * Path-based addressing, under stress.
 *
 * `NodePath` in `snapshot.ts` is "child indices from the root", and its own doc
 * comment admits the cost: inserting a sibling renumbers everything after it, so
 * the differ must match nodes by shape and provenance *before* falling back to
 * path. This list is the fixture that decides whether it actually does.
 *
 * Three perturbations, which a naive path-keyed differ cannot tell apart because
 * all three change the text at most path positions:
 *
 * - **reorder** — same nodes, same count, different order. The honest report is a
 *   small number of moves. A path-keyed differ reports every item as "text
 *   changed", which is not wrong so much as useless: it buries the one fact a
 *   reviewer wants.
 * - **insert at the front** — one node added, everything after it shifted by one.
 *   Path alone says every item changed; shape-and-provenance matching says one was
 *   added.
 * - **relabel one item** — genuinely one text change, and the control that proves
 *   the other two are being over-reported rather than the differ being blind.
 *
 * All three are `hash-changed`/`geometry`, so the hash cannot distinguish them —
 * which is exactly why they are here. They score the *diff quality* half of M0,
 * not the hash-stability half, and a corpus that only measured hashes would have
 * nothing to say about the difference between a useful report and a useless one.
 */

export interface ItemListProps {
  readonly items: readonly string[];
}

export function ItemList({ items }: ItemListProps) {
  return (
    <ul className="ks-list">
      {items.map((item) => (
        <li key={item} className="ks-list__item">
          {item}
        </li>
      ))}
    </ul>
  );
}

ItemList.displayName = 'ItemList';

export const BASE_ITEMS: readonly string[] = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'];

/** Rotate by one: identical multiset, different order. */
export const ROTATED_ITEMS: readonly string[] = ['Echo', 'Alpha', 'Bravo', 'Charlie', 'Delta'];

/** One node added at the front — the worst case for positional addressing. */
export const PREPENDED_ITEMS: readonly string[] = ['Zulu', ...BASE_ITEMS];

/** Exactly one text change, at a stable position. The control. */
export const RELABELLED_ITEMS: readonly string[] = ['Alpha', 'Bravo', 'Cobalt', 'Delta', 'Echo'];
