/**
 * Wiring: how a component is attached to its framework, as a dimension of its own.
 *
 * The other bands read the artefact. `structure` reads the tree the renderer
 * produced, `style` reads the declarations that matched it, `geometry` reads the
 * boxes those declarations made. All three are downstream of a decision that has
 * already been taken, and none of them can reach back past the render to say what
 * the component *is*.
 *
 * Wiring is that reach. Two components can produce byte-identical structure,
 * semantics, text, style and geometry while one of them subscribes to a theme
 * context and the other does not; while one is memoised and the other re-renders
 * on every parent tick; while one keys a list by identity and the other by index,
 * so that the first survives a reorder and the second corrupts. Those are
 * differences in the component, they are the ones that decide how it behaves
 * under change, and no amount of HTML and CSS contains them. They are in the
 * fiber, so the fiber is where they are read from.
 *
 * ## Why this is a wire type in `core` and a reader in `react`
 *
 * Exactly like {@link Provenance}: the collector produces it, it travels with the
 * document over every wire this project has, and a differ on the other end reads
 * it without ever having seen a fiber. A type the snapshot format needs cannot
 * live in the framework adapter, and the adapter is the only thing that should
 * know what a `_debugHookTypes` is.
 *
 * ## What is deliberately not here
 *
 * **State values.** `useState(0)` records `useState`, never `0`. A hook's *value*
 * is the thing that legitimately differs between two readings of one page — it is
 * the ticker, the timestamp, the animation frame — so a band carrying it would be
 * a flake generator wearing a band's name. Wiring carries the shape of the
 * component's attachment and nothing that attachment happened to be holding.
 *
 * **Anything temporal.** Whether an instance *remounted* is the single most useful
 * thing the fiber knows, and it is not in here, because it is not a property of a
 * revision — it is a property of a reading, and by construction it differs between
 * two readings of one unchanged page. It lives in `@variance-authority/react`'s
 * `remounted()` as a finding, next to `pendingSuspense`. The rule that separates
 * them is stated once, in `wiring.test.ts`, and it is checkable: read the same
 * page twice without changing anything, and if the value moved it is not a band.
 */

/** How the framework holds a component, at one boundary. */
export interface Wiring {
  /**
   * Hook names in call order: `['useState', 'useRef', 'useEffect']`.
   *
   * Exact rather than inferred. React records the list itself during a
   * development render, so this is the compiler's own account of the component
   * and not a reconstruction from the hook chain's shape — which cannot in
   * principle separate `useMemo` from `useCallback`, or `useEffect` from
   * `useLayoutEffect`, because those pairs build identical memo cells.
   *
   * Absent when the adapter could not see them, and that covers more than a
   * production build: React only populates its record once a hook actually runs,
   * so a component that declares none is indistinguishable from one nobody could
   * read. Absent for both, never `[]` — "declares no hooks" is a positive claim
   * and this observation does not support it (ADR-0002).
   */
  readonly hooks?: readonly string[];

  /**
   * The wrappers the author put around the component, outermost first.
   *
   * `memo` is a claim about when the component may be skipped, and `forwardRef`
   * is a claim about who owns its host node. Both are load-bearing, both are
   * invisible in the output, and both are ordinary things to lose in a refactor:
   * dropping a `memo` changes no pixel and no digest in any other band, and turns
   * a component that rendered once into one that renders on every parent tick.
   *
   * A list rather than one value because `memo(forwardRef(f))` is both, and
   * reporting either alone would say a component lost a wrapper it still has.
   */
  readonly wrappers?: readonly ('memo' | 'forwardRef')[];

  /**
   * Contexts this boundary subscribes to, by display name, sorted.
   *
   * The dependency edge that decides re-renders and that nothing in the document
   * shows. A component under a theme switch that changed without appearing here
   * got its change through the CSS cascade rather than through React, and those
   * are different explanations for the same visual difference.
   *
   * Anonymous contexts are named `(anonymous)` rather than dropped — a
   * subscription nobody named is still a subscription, and dropping it would let
   * a component that gained one compare equal to one that has none.
   */
  readonly contexts?: readonly string[];

  /**
   * The reconciliation key React holds this boundary under, when it has one.
   *
   * Two lists that serialize to the same `<li>a</li><li>b</li>` reconcile
   * differently depending on whether their keys are `'a', 'b'` or `'0', '1'`, and
   * the difference only becomes visible when the list reorders — at which point
   * the index-keyed one has moved every child's state onto the wrong row. The
   * fiber holds the answer before the reorder, so this is a defect readable in a
   * single still reading of a page that currently looks perfect.
   *
   * Absent when React assigned none, which is the ordinary case for a component
   * that is not one of several siblings.
   */
  readonly key?: string;
}

/**
 * Whether a key looks positional.
 *
 * A heuristic, and named as one. `key: '0'` on the first child, `'1'` on the
 * second, is what `items.map((item, index) => ...)` produces and is the defect;
 * `key: '0'` on a list of numeric ids is the same string arrived at honestly. The
 * two are indistinguishable at one node and separable across siblings, which is
 * why this takes the whole run of keys rather than one of them.
 *
 * Returns `false` for anything shorter than two siblings: a one-element list
 * keyed `'0'` reorders into nothing and there is no defect to report.
 */
export function keyedByPosition(keys: readonly (string | undefined)[]): boolean {
  if (keys.length < 2) return false;
  return keys.every((key, index) => key === String(index));
}
