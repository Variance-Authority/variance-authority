/**
 * What we can honestly say about the React runtime that rendered a page.
 *
 * This matters beyond curiosity: fiber internals are the least stable thing this
 * project reads, so a snapshot whose provenance came from an unknown React
 * version is a snapshot whose chains cannot be explained after the fact. The
 * version belongs in the environment key (ADR-0002) — a React upgrade that
 * changes owner chains must read as a clean cache miss, not as a diff.
 *
 * The honesty constraint: we report the exact version *only* when something
 * states it. Nothing on a fiber carries a version number, so with no DevTools
 * hook the best available fact is which expando naming convention `react-dom`
 * used, which bounds the major version without pretending to pin it.
 */

/** Prefix → the React generation that introduced it. Bounds, not a version. */
const KEY_FORMATS = [
  { prefix: '__reactFiber$', format: 'reactFiber', since: '>=17' },
  { prefix: '__reactInternalInstance$', format: 'reactInternalInstance', since: '16' },
] as const;

export type ReactKeyFormat = (typeof KEY_FORMATS)[number]['format'];

export interface ReactRuntimeInfo {
  /** Exact `react-dom` version. Present only when a DevTools hook exposed one. */
  readonly version?: string;
  /** Which expando convention was observed on the node. */
  readonly keyFormat?: ReactKeyFormat;
  /** Coarse major-version bound implied by `keyFormat`, e.g. `>=17`. */
  readonly majorHint?: string;
}

interface DevToolsHook {
  readonly renderers?: Map<number, { version?: string }> | undefined;
}

/**
 * Read the version from the DevTools hook if — and only if — one is present.
 *
 * The hook is a *secondary* source by design. It exists when the extension is
 * installed or a harness installed it deliberately, and it does not exist in a
 * bare vitest process or a fresh Playwright context. Nothing in this package may
 * require it.
 */
export function detectReactVersion(scope: object = globalThis): string | undefined {
  const hook = (scope as Record<string, unknown>)['__REACT_DEVTOOLS_GLOBAL_HOOK__'] as
    | DevToolsHook
    | undefined;

  const renderers = hook?.renderers;
  if (!renderers || typeof renderers.forEach !== 'function') return undefined;

  let version: string | undefined;
  renderers.forEach((renderer) => {
    // Multiple renderers (react-dom plus react-three-fiber, say) can coexist.
    // First wins: this is a diagnostic, and disambiguating them would require
    // knowing which renderer produced the node we are about to inspect.
    if (version === undefined && typeof renderer?.version === 'string') {
      version = renderer.version;
    }
  });
  return version;
}

/** Everything we can establish about the runtime behind a given node. */
export function detectReactRuntime(node?: Node, scope: object = globalThis): ReactRuntimeInfo {
  const info: {
    version?: string;
    keyFormat?: ReactKeyFormat;
    majorHint?: string;
  } = {};

  const version = detectReactVersion(scope);
  if (version !== undefined) info.version = version;

  if (node) {
    const keys = Object.keys(node as unknown as object);
    for (const candidate of KEY_FORMATS) {
      if (keys.some((key) => key.startsWith(candidate.prefix))) {
        info.keyFormat = candidate.format;
        info.majorHint = candidate.since;
        break;
      }
    }
  }

  return info;
}
