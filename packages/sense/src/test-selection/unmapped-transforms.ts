/**
 * The plugins ahead of the probes that rewrote a module and returned no map.
 *
 * Rollup reads a result without a map as one it cannot follow, and a build
 * composes it to nothing, which the placement refuses region by region. The
 * Vite dev server — and Vitest, which runs on it — composes it as a map that
 * moves nothing: `getCombinedSourcemap()` then hands back positions that name
 * the wrong code, and probes placed through it would fire for code that did
 * not run. Nothing in the composed map says so, so each step is watched as it
 * happens: every other plugin's `transform` is wrapped once the config is
 * resolved, as `vite-plugin-inspect` wraps them, and a step that changed the
 * text without a map is noted on the transform's context, which Vite shares
 * across every plugin of one pass. `map: null` is the plugin saying it moved
 * nothing, as Rollup reads it, and is believed.
 */

/** A plugin as Vite resolves it, as far as this reads one. */
interface ResolvedPlugin {
  readonly name: string;
  transform?: unknown;
}

type Handler = (this: object, code: string, id: string, ...rest: unknown[]) => unknown;

const noted = new WeakMap<object, string[]>();
const watched = new WeakSet<object>();

/**
 * Wrap the `transform` of every plugin but `self` in `plugins` so a step that
 * rewrote a module and returned no map is noted on its context. Each plugin is
 * wrapped once, however many seams or environments resolve it.
 */
export function watchUnmapped(plugins: readonly ResolvedPlugin[], self: string): void {
  for (const plugin of plugins) {
    if (plugin.name === self || plugin.transform === undefined || watched.has(plugin)) continue;
    watched.add(plugin);
    const hook = plugin.transform;
    if (typeof hook === 'function') {
      plugin.transform = wrapped(plugin.name, hook as Handler);
    } else if (typeof hook === 'object' && hook !== null && typeof (hook as { handler?: unknown }).handler === 'function') {
      // An object hook keeps its `order` and `filter`: only the handler changes.
      const object = hook as { handler: Handler };
      plugin.transform = { ...object, handler: wrapped(plugin.name, object.handler) };
    }
  }
}

/** The plugins noted on `context`: each one ahead of the caller that rewrote the module without a map. */
export function unmappedSteps(context: unknown): readonly string[] {
  return typeof context === 'object' && context !== null ? (noted.get(context) ?? []) : [];
}

function wrapped(name: string, handler: Handler): Handler {
  return function (this: object, code, id, ...rest) {
    const result = handler.call(this, code, id, ...rest);
    if (typeof (result as PromiseLike<unknown> | undefined)?.then === 'function') {
      return (result as PromiseLike<unknown>).then((value) => note(this, name, code, value));
    }
    return note(this, name, code, result);
  };
}

function note(context: object, name: string, code: string, result: unknown): unknown {
  if (typeof context !== 'object' || context === null) return result;
  const written = typeof result === 'string' ? result : (result as { code?: unknown } | null | undefined)?.code;
  const map = typeof result === 'string' ? undefined : (result as { map?: unknown } | null | undefined)?.map;
  if (typeof written === 'string' && written !== code && map === undefined) {
    const list = noted.get(context);
    if (list === undefined) noted.set(context, [name]);
    else if (!list.includes(name)) list.push(name);
  }
  return result;
}
