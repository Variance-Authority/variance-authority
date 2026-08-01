import type { DebugComponentInfo, Fiber } from './fiber.js';

/**
 * Resolving a component's display name.
 *
 * The name is the only part of provenance a human reads, so it has to be the
 * name the *author* would use. That means unwrapping React's higher-order
 * wrappers rather than reporting them: DevTools shows `Memo(ForwardRef(Row))`
 * because it is describing the tree to someone debugging React; a docket entry
 * (spec §6.2) is describing a change to someone who owns `Row` and does not
 * care that it is memoised.
 */

/** Fallback when nothing in the chain yields a name. Never an empty string. */
export const ANONYMOUS = 'Anonymous';

/** Guards against a wrapper cycle in a hand-rolled HOC. */
const MAX_UNWRAP_DEPTH = 10;

/**
 * `$$typeof` brands for the wrapper objects, matched by symbol *description*.
 *
 * INTERNAL CONTRACT — but a mild one: these registered symbols are the same
 * brand `core` already matches structurally to detect elements without
 * importing React. Matching the description rather than `Symbol.for(...)` keeps
 * this correct across realms (an iframe or a jsdom window has its own registry
 * for unregistered symbols, and Playwright hands us cross-realm objects).
 */
const MEMO = 'react.memo';
const FORWARD_REF = 'react.forward_ref';
const LAZY = 'react.lazy';

/**
 * `displayName` → function/class `name` → `Anonymous`, unwrapping wrappers.
 *
 * Precedence matters at each level: an explicit `displayName` set *on the
 * wrapper* wins, because someone who writes `MemoRow.displayName = 'Row'` has
 * stated the answer. Only when the wrapper is unnamed do we look inside it.
 * `memo(forwardRef(fn))` nests two wrappers, so this recurses rather than
 * peeling a single layer.
 */
export function componentName(type: unknown): string {
  return nameOf(type, 0) ?? ANONYMOUS;
}

function nameOf(type: unknown, depth: number): string | null {
  if (depth > MAX_UNWRAP_DEPTH) return null;
  if (type === null || type === undefined) return null;

  // A host fiber's type is the tag name. Reached only defensively — host fibers
  // never become owner frames.
  if (typeof type === 'string') return type;

  if (typeof type === 'function') {
    const fn = type as { displayName?: unknown; name?: unknown };
    if (typeof fn.displayName === 'string' && fn.displayName !== '') return fn.displayName;
    if (typeof fn.name === 'string' && fn.name !== '') return fn.name;
    return null;
  }

  if (typeof type !== 'object') return null;

  const wrapper = type as {
    $$typeof?: unknown;
    displayName?: unknown;
    type?: unknown;
    render?: unknown;
    _payload?: unknown;
    _result?: unknown;
  };

  if (typeof wrapper.displayName === 'string' && wrapper.displayName !== '') {
    return wrapper.displayName;
  }

  const brand =
    typeof wrapper.$$typeof === 'symbol' ? (wrapper.$$typeof.description ?? '') : '';

  switch (brand) {
    case MEMO:
      // `memo(X).type` is X — which may itself be a `forwardRef` object.
      return nameOf(wrapper.type, depth + 1);
    case FORWARD_REF:
      // `forwardRef(fn).render` is fn. The wrapper is an object, so a bare
      // `.name` lookup finds nothing and this hop is not optional.
      return nameOf(wrapper.render, depth + 1);
    case LAZY:
      // Only nameable once the payload has resolved; before that there is
      // genuinely no name to report, and inventing one would be a lie in a
      // field a human reads.
      return nameOf((wrapper._payload as { _result?: unknown } | undefined)?._result, depth + 1);
    default:
      return null;
  }
}

/**
 * Name a fiber's component, reading `elementType` before `type`.
 *
 * The order is not interchangeable. For a `SimpleMemoComponent` (tag 15) React
 * sets `fiber.type` to the *inner function* and keeps the `memo()` object only
 * in `fiber.elementType`. So `MemoRow.displayName = 'Row'` — a name the author
 * explicitly chose — is invisible from `type` alone; reading `type` first
 * silently reports the inner function's name instead and the author's rename
 * never reaches the docket. Verified on React 19.2.8.
 *
 * `elementType` is "the type as authored" for every tag, which is precisely the
 * thing whose name a human would recognise. `type` remains the fallback for the
 * fibers React synthesises, where `elementType` can be null.
 *
 * INTERNAL CONTRACT: if the two fields' meanings swap, the symptom is wrapper
 * names leaking into chains (`Memo(Row)`-shaped objects resolving to nothing and
 * falling through to `Anonymous`), not a crash.
 */
export function fiberComponentName(fiber: Fiber): string {
  return nameOf(fiber.elementType, 0) ?? nameOf(fiber.type, 0) ?? ANONYMOUS;
}

/**
 * Name the component recorded in `fiber._debugOwner`.
 *
 * React 19 made this field polymorphic: a client owner is a `Fiber` (has `tag`,
 * carries the component in `type`), while a server component owner is a
 * `ReactComponentInfo` — a plain record with a `name` and no fiber machinery at
 * all. Both shapes are handled here because a page can contain both, and the
 * distinction is exactly the RSC boundary spec §11.6 asks about.
 */
export function debugOwnerName(owner: Fiber | DebugComponentInfo | null | undefined): string | null {
  if (!owner) return null;

  if (typeof (owner as Fiber).tag === 'number') {
    const fiber = owner as Fiber;
    return nameOf(fiber.elementType, 0) ?? nameOf(fiber.type, 0);
  }

  const info = owner as DebugComponentInfo;
  return typeof info.name === 'string' && info.name !== '' ? info.name : null;
}
