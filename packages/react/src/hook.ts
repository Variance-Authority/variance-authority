/**
 * React's DevTools hook: the one object `react-dom` announces itself and its
 * commits to, and the shape a tap installs when nothing else has.
 */

export const HOOK_KEY = '__REACT_DEVTOOLS_GLOBAL_HOOK__';
const CONTAINER_KEY_PREFIX = '__reactContainer$';

export interface DevToolsHook {
  renderers?: Map<number, { version?: string }>;
  supportsFiber?: boolean;
  inject?: (internals: unknown) => number;
  // `| undefined` in the value type, not only optional: `stop()` restores
  // whatever was here before, and on a page with no DevTools that is `undefined`.
  // Under `exactOptionalPropertyTypes` a bare `?:` cannot be assigned back what
  // it was read as, which would leave the tap unable to undo itself.
  onCommitFiberRoot?: ((...args: unknown[]) => void) | undefined;
  onPostCommitFiberRoot?: ((...args: unknown[]) => void) | undefined;
  onCommitFiberUnmount?: ((...args: unknown[]) => void) | undefined;
}

/**
 * The minimum `react-dom` requires of a hook, and nothing more.
 *
 * `inject` must return an id and the `on*` methods must exist, or `react-dom`
 * throws while wiring itself up — which would break the page this is supposed to
 * be observing. `supportsFiber` is what it checks before talking at all.
 */
export function installHook(scope: Record<string, unknown>): DevToolsHook {
  const renderers = new Map<number, { version?: string }>();
  let nextId = 1;

  const hook: DevToolsHook = {
    renderers,
    supportsFiber: true,
    inject: (internals: unknown) => {
      const id = nextId++;
      renderers.set(id, (internals as { version?: string }) ?? {});
      return id;
    },
    onCommitFiberRoot: () => {},
    onPostCommitFiberRoot: () => {},
    onCommitFiberUnmount: () => {},
  };

  scope[HOOK_KEY] = hook;
  return hook;
}

/**
 * The version the first renderer that introduced itself to the hook gave.
 *
 * Multiple renderers (react-dom plus react-three-fiber, say) can coexist. First
 * wins: this is a diagnostic, and disambiguating them would require knowing
 * which renderer produced the node about to be inspected.
 */
export function injectedVersion(hook: Pick<DevToolsHook, 'renderers'> | undefined): string | undefined {
  const renderers = hook?.renderers;
  if (!renderers || typeof renderers.forEach !== 'function') return undefined;

  let version: string | undefined;
  renderers.forEach((renderer) => {
    if (version === undefined && typeof renderer?.version === 'string') version = renderer.version;
  });
  return version;
}

/**
 * Has React already mounted something in this document?
 *
 * The observable proxy for "the hook was installed too late". Structural, like
 * `findReactContainers` — it asks the document rather than trusting a flag
 * somebody set.
 */
export function reactHasMounted(scope: Record<string, unknown>): boolean {
  const doc = (scope['document'] ?? globalThis.document) as Document | undefined;
  if (!doc?.querySelectorAll) return false;

  const all = doc.querySelectorAll('*');
  for (let index = 0; index < all.length; index += 1) {
    for (const key of Object.keys(all[index] as Element)) {
      if (key.startsWith(CONTAINER_KEY_PREFIX)) return true;
    }
  }
  return false;
}
