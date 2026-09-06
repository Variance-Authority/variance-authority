import type { Fiber } from './fiber.js';
import { fiberComponentName } from './names.js';

/**
 * The component functions a page's provenance has named, held by identity.
 *
 * Provenance reports a component by name, and a name is one step short of a
 * file: the source index matches it against declarations in the text, and two
 * files declaring a `Button` leave it ambiguous. The function itself is not
 * ambiguous. The engine that compiled it knows the script and the position it
 * came from, and asked over the debugger protocol it answers exactly — but only
 * for a value it can be handed, which is what this registry keeps.
 *
 * The registry lives in the page, because the functions do. Nothing here is
 * serialized: the Node side reads `names` and asks the engine about
 * `functions[i]` by index, so the values never cross the bridge as anything but
 * an object handle. A bundle evaluated twice builds two registries, and `id` is
 * how a reader tells them apart rather than continuing to count from the old
 * one.
 */
export interface DeclaredComponents {
  /** Distinguishes this registry from the one a re-injected bundle builds. */
  readonly id: string;
  /** The name provenance reports for `functions[i]`, in registration order. */
  readonly names: readonly string[];
  /** The live function or class behind each name. Read by the engine, never copied. */
  readonly functions: readonly Function[];
}

/** The half of a registry provenance writes to. */
export interface DeclarationSink {
  /** Remember the component behind an owner frame. Once per function, whatever it is called. */
  readonly note: (fiber: Fiber) => void;
}

export interface DeclarationRegistry extends DeclaredComponents, DeclarationSink {}

/**
 * A registry for one bundle installation, to be handed to `provenanceOf` as its
 * sink and installed on the page agent as `declared`. Registers a function once
 * however many fibers point at it, and never throws: a value that is not a
 * component is not registered, which is the whole of the error handling.
 */
export function createDeclarationRegistry(): DeclarationRegistry {
  const names: string[] = [];
  const functions: Function[] = [];
  const seen = new Set<Function>();

  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    names,
    functions,
    note(fiber) {
      const fn = componentFunction(fiber.type) ?? componentFunction(fiber.elementType);
      if (fn === null || seen.has(fn)) return;
      seen.add(fn);
      names.push(fiberComponentName(fiber));
      functions.push(fn);
    },
  };
}

/**
 * `$$typeof` brands, matched by description as `names.ts` does and for the same
 * reason: a cross-realm symbol is not the one `Symbol.for` returns here.
 */
const MEMO = 'react.memo';
const FORWARD_REF = 'react.forward_ref';
const LAZY = 'react.lazy';

/** Guards against a wrapper cycle in a hand-rolled HOC. */
const MAX_UNWRAP_DEPTH = 10;

/**
 * The function that renders, out of whatever wrapper the author handed React.
 *
 * `memo(X)` holds X under `type`, `forwardRef(fn)` holds fn under `render`, and a
 * resolved `lazy` holds its module's default under the payload. A class is a
 * function to the engine as well, and its location is the class declaration.
 * An unresolved `lazy` and a host tag have no function, and `null` says so.
 */
export function componentFunction(type: unknown): Function | null {
  return functionOf(type, 0);
}

function functionOf(type: unknown, depth: number): Function | null {
  if (depth > MAX_UNWRAP_DEPTH) return null;
  if (typeof type === 'function') return type;
  if (type === null || typeof type !== 'object') return null;

  const wrapper = type as {
    $$typeof?: unknown;
    type?: unknown;
    render?: unknown;
    _payload?: unknown;
  };
  const brand =
    typeof wrapper.$$typeof === 'symbol' ? (wrapper.$$typeof.description ?? '') : '';

  switch (brand) {
    case MEMO:
      return functionOf(wrapper.type, depth + 1);
    case FORWARD_REF:
      return functionOf(wrapper.render, depth + 1);
    case LAZY:
      return functionOf((wrapper._payload as { _result?: unknown } | undefined)?._result, depth + 1);
    default:
      return null;
  }
}
