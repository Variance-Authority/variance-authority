import { heldDigest, type HeldCell, type HeldValue, type Holding } from '@variance-authority/core';
import type { Fiber } from './fiber.js';
import { componentFiberOf } from './wiring.js';

/**
 * Reading what a component was holding, so a difference can be explained rather
 * than only reported.
 *
 * `wiring.ts` reads the fiber to answer *what is this component*. This reads it
 * to answer the next question, and the one a person actually asks when two
 * readings disagree: **why did it decide differently.** A `<div>` that rendered
 * a `<p>` on one side and a `<span>` on the other is the symptom; the branch the
 * component took is the behaviour; the `useState` cell the branch tested is the
 * cause, and only the last one is a thing anybody can go and fix.
 *
 * ## The alignment problem, which is the whole difficulty
 *
 * React records hook *names* on `_debugHookTypes` and hook *cells* on a linked
 * list off `memoizedState`, and the two are not parallel arrays. Measured on
 * 19.2.8:
 *
 * | hook | cells it builds |
 * |---|---|
 * | `useContext`, `useDebugValue` | **none** |
 * | `useSyncExternalStore`, `useTransition` | **two** |
 * | `useActionState` | **three** |
 * | everything else here | one |
 *
 * So a component calling `useState`, `useContext`, `useMemo` has three names and
 * two cells, and zipping them by index reports the `useMemo` name against the
 * `useContext` position — which is not an error anybody sees. It is a digest of
 * a `[value, deps]` tuple filed under `useMemo` when it belongs to `useCallback`,
 * an effect object digested as if it were state, and an attribution that points
 * at the wrong line of the right component. {@link HOOKS} is the table that
 * converts between the two indices, it was measured rather than reasoned about,
 * and `holding.test.tsx` asserts every row so that a React release which moves
 * one fails there.
 *
 * `use()` is the hook that needed no row: React records no name for it and it
 * builds no cell, so it is invisible to both sides of the join and cannot shift
 * the alignment. That is measured too, including interleaved between hooks that
 * do build cells, because "invisible" is a claim about the dangerous case.
 *
 * ## Why an unknown hook stops the read
 *
 * A name this table does not know has unknown arity, so every cell after it is
 * unattributable. The reader stops and reports the name in {@link Holding.unread}
 * rather than guessing one cell and carrying on. That is ADR-0002 at the level
 * of a single component: a prefix that says where it stopped is evidence, and a
 * full list silently misaligned from the fourth entry on is the confident wrong
 * answer this project exists to refuse.
 *
 * ## What is never read
 *
 * A value, out of the page. Every field is a digest taken by `heldDigest` — the
 * same projection `propsDigest` uses, chosen for reuse and kept for its
 * defences: a `useRef` holding a DOM node is named rather than walked, and an
 * effect cell's ring closes into a token instead of a hang.
 */

/** How many cells a hook consumes, and which of them is worth digesting. */
interface HookShape {
  /** Cells this hook appends to the chain. The join key; see {@link HOOKS}. */
  readonly cells: number;

  /**
   * What to digest out of the **first** of those cells, or `none`.
   *
   * Per hook because the cells are not alike and one rule over them is either
   * useless or fatal — an effect cell digested as a value walks a ring.
   */
  readonly read: 'value' | 'current' | 'memo-deps' | 'effect-deps' | 'none';
}

/**
 * Hook name to cell arity and projection, measured on React 19.2.8.
 *
 * INTERNAL CONTRACT, and the load-bearing one in this file. Every row is an
 * observation of a React internal with no public guarantee behind it. A row that
 * goes stale does not throw: it slides every later cell onto the wrong hook, so
 * `holding.test.tsx` renders each hook alone and asserts its arity and the shape
 * of its first cell.
 *
 * Absent rows are the safe direction — see {@link Holding.unread}.
 */
const HOOKS: ReadonlyMap<string, HookShape> = new Map<string, HookShape>([
  // Retained state, in the cell itself. The rows that answer "why this branch".
  ['useState', { cells: 1, read: 'value' }],
  ['useReducer', { cells: 1, read: 'value' }],
  ['useOptimistic', { cells: 1, read: 'value' }],
  ['useDeferredValue', { cells: 1, read: 'value' }],
  ['useId', { cells: 1, read: 'value' }],

  // The external-state row. `useSyncExternalStore` is how every store binding in
  // the ecosystem reaches React — Redux, Zustand, Jotai, `valtio`, the URL — so
  // one row covers "external state" without this package knowing any of their
  // names. Its second cell is an effect and is skipped.
  ['useSyncExternalStore', { cells: 2, read: 'value' }],

  // First cell is `isPending`; the second is a function React rebuilds.
  ['useTransition', { cells: 2, read: 'value' }],
  // State, then `isPending`, then a dispatch function.
  ['useActionState', { cells: 3, read: 'value' }],

  // The cell is the ref object; its identity is stable across renders, so the
  // digest has to reach through to what it holds.
  ['useRef', { cells: 1, read: 'current' }],

  // `[value, deps]`. The deps are digested and the value is not: a `useMemo`
  // value is a function of its deps, and a `useCallback` value is a closure
  // whose identity moves every render it is rebuilt.
  ['useMemo', { cells: 1, read: 'memo-deps' }],
  ['useCallback', { cells: 1, read: 'memo-deps' }],

  // The cell is an effect object whose `next` closes a ring. Only `deps` is
  // read — never the object, and never `create`, which is a closure.
  ['useEffect', { cells: 1, read: 'effect-deps' }],
  ['useLayoutEffect', { cells: 1, read: 'effect-deps' }],
  ['useInsertionEffect', { cells: 1, read: 'effect-deps' }],
  ['useImperativeHandle', { cells: 1, read: 'effect-deps' }],

  // Build no cell at all. Present as rows rather than omitted, because omission
  // means *unknown arity* and would truncate the read at the first `useContext`
  // — which is to say, on most components. A context's value is not lost by
  // this: it is read from the dependency list into `Holding.contexts`.
  ['useContext', { cells: 0, read: 'none' }],
  ['useDebugValue', { cells: 0, read: 'none' }],
]);

/** One node of React's hook chain. Structural, for the reason `Fiber` is. */
interface HookCellNode {
  readonly memoizedState?: unknown;
  readonly next?: HookCellNode | null;
}

/** Bounds the hook-chain walk against a corrupted `next`. */
const MAX_CELLS = 1_000;

/** Bounds the context list walk, as `wiringOf` does. */
const MAX_CONTEXTS = 256;

/**
 * What the component that rendered this node was holding, or undefined.
 *
 * Undefined rather than an empty object when there is nothing to say, on the
 * ADR-0002 rule `wiringOf` states: a page under a framework this package cannot
 * read must be *absent* from the evidence rather than carrying a digest of
 * emptiness, or a plain-DOM page and a React page compare as having agreed.
 */
export function holdingOf(node: Node): Holding | undefined {
  const component = componentFiberOf(node);
  if (component === null) return undefined;

  const { cells, unread } = cellsOf(component);
  const contexts = contextsOf(component);
  const props = propsOf(component);

  if (cells === undefined && contexts === undefined && props === undefined) return undefined;

  return {
    // Present-and-empty when React's hook record was readable and nothing in it
    // retained anything; **absent** when it was not readable at all. The two
    // must not collapse, and the reader that depends on it is the ladder:
    // "every input agreed and the output moved" is an accusation of
    // nondeterminism, and it may only be made about inputs somebody actually
    // read. A production build reporting `[]` would turn every unexplained
    // movement into a false one (ADR-0002).
    ...(cells === undefined ? {} : { cells }),
    ...(contexts ? { contexts } : {}),
    ...(props ? { props } : {}),
    ...(unread === undefined ? {} : { unread }),
  };
}

/**
 * Walk names and cells together, converting between the two indices.
 *
 * The returned `index` is the position in {@link Holding} terms — the count of
 * hook *calls*, which is what a reader gets by counting down the component and
 * what indexes `Wiring.hooks`. The cell chain is advanced by each hook's own
 * arity, which is the only thing keeping the two in step.
 */
function cellsOf(fiber: Fiber): { cells?: readonly HeldCell[]; unread?: string } {
  const names = fiber._debugHookTypes;

  // A production build populates neither this nor `Wiring.hooks`. Absent, not
  // empty: "this component retained nothing" is a positive claim that a build
  // carrying no hook metadata cannot support, and the ladder above is entitled
  // to act on the difference between that and a reading.
  //
  // The distinction that matters is the property's *presence*. React creates
  // every fiber with `_debugHookTypes = null` under `__DEV__` and assigns the
  // array on the first hook call, so `null` is the positive reading "this
  // component ran no hooks" and only `undefined` is silence. Collapsing the two
  // costs the whole flake case: a component with no hooks and no props that
  // renders differently twice is exactly the shape worth calling
  // nondeterministic, and it would instead be reported as unreadable.
  if (names === undefined) return {};
  if (names === null) return { cells: [] };
  if (!Array.isArray(names)) return {};

  const found: HeldCell[] = [];
  let cell = (fiber.memoizedState ?? null) as HookCellNode | null;
  let walked = 0;

  for (let index = 0; index < names.length; index += 1) {
    const hook = names[index];
    if (typeof hook !== 'string') return { cells: found, unread: '(unnamed)' };

    const shape = HOOKS.get(hook);
    if (shape === undefined) return { cells: found, unread: hook };
    if (shape.cells === 0) continue;

    // The chain ran out while names remain: the two records disagree, which is
    // the exact condition this reader must not paper over. Whatever alignment
    // held up to here is kept; nothing is invented past it.
    if (cell === null) return { cells: found, unread: hook };

    const head = cell;
    for (let step = 0; step < shape.cells && cell !== null; step += 1) {
      if ((walked += 1) > MAX_CELLS) return { cells: found, unread: hook };
      cell = cell.next ?? null;
    }

    const value = project(shape.read, head.memoizedState);
    if (value !== ABSENT) found.push({ index, hook, digest: heldDigest(value) });
  }

  return { cells: found };
}

/**
 * A cell whose shape did not match its hook's row, and which is therefore not
 * reported at all.
 *
 * A sentinel rather than `undefined`, because `undefined` is a value a hook can
 * legitimately hold — `useState<string | undefined>(undefined)` is ordinary, and
 * `heldDigest` distinguishes it from absence on purpose. Collapsing the two
 * would make a state that became defined look like a cell that appeared.
 */
const ABSENT: unique symbol = Symbol('absent');

/**
 * Take the digestible part out of a cell, or {@link ABSENT}.
 *
 * Total, on `jsxSourceOf`'s rule: this runs over React internals for arbitrary
 * user code, and a shape that does not match is absence rather than a throw. A
 * mismatch here means the table is stale, and the correct response is to report
 * one fewer cell — not to take the capture down with the page in it.
 */
function project(read: HookShape['read'], cell: unknown): unknown {
  switch (read) {
    case 'value':
      return cell;

    case 'current':
      if (cell === null || typeof cell !== 'object' || !('current' in cell)) return ABSENT;
      return (cell as { current: unknown }).current;

    case 'memo-deps':
      // `[value, deps]`. A `deps` of `null` is what `useMemo(fn)` with no
      // dependency array produces, and it is a real reading rather than a
      // mismatch: it says this memo is recomputed every render.
      if (!Array.isArray(cell) || cell.length < 2) return ABSENT;
      return cell[1];

    case 'effect-deps':
      if (cell === null || typeof cell !== 'object' || !('deps' in cell)) return ABSENT;
      return (cell as { deps: unknown }).deps;

    case 'none':
      return ABSENT;
  }
}

/**
 * Context values this boundary read, by display name, sorted.
 *
 * Sorted by code unit rather than locale, like every other list that reaches an
 * artifact here. Anonymous contexts are named `(anonymous)` for `wiringOf`'s
 * reason: a subscription nobody named is still a subscription.
 *
 * A duplicate name keeps its first value and drops the rest, which is a real
 * conflation — two distinct anonymous contexts collapse to one entry. It is the
 * conservative direction: the alternative is a positional index that renumbers
 * whenever an unrelated `useContext` is added or removed, so a refactor would
 * read as every context having changed.
 */
function contextsOf(fiber: Fiber): readonly HeldValue[] | undefined {
  let link = fiber.dependencies?.firstContext;
  if (!link) return undefined;

  const values = new Map<string, unknown>();
  for (let seen = 0; seen < MAX_CONTEXTS && link; seen += 1) {
    const displayName = link.context?.displayName;
    const name = typeof displayName === 'string' && displayName !== '' ? displayName : '(anonymous)';
    if (!values.has(name)) values.set(name, link.memoizedValue);
    link = link.next;
  }

  if (values.size === 0) return undefined;
  return [...values.keys()]
    .sort()
    .map((name) => ({ name, digest: heldDigest(values.get(name)) }));
}

/**
 * The props object, one digest per key, sorted — spec 0024's map, populated.
 *
 * `children` is excluded, and the exclusion is the same one `propsDigest` and
 * `resolve.ts` already make for the same reason: `children` *is* the subtree, so
 * digesting it would make every ancestor's inputs a function of every
 * descendant's edit, and root attribution would name the outermost component
 * every time.
 *
 * Symbol keys are skipped by `Object.keys` already, which is what keeps
 * `JSX_SOURCE` out of here without this file having to know it exists.
 */
function propsOf(fiber: Fiber): readonly HeldValue[] | undefined {
  const props = fiber.memoizedProps;
  if (props === null || typeof props !== 'object') return undefined;

  const names = Object.keys(props)
    .filter((name) => name !== 'children')
    .sort();
  if (names.length === 0) return undefined;

  return names.map((name) => ({ name, digest: heldDigest(props[name]) }));
}
