/**
 * The plugins ahead of the probes that rewrote a module and returned no map.
 *
 * The Vite dev server — and Vitest, which runs on it — composes such a result
 * as a map that moves nothing: `getCombinedSourcemap()` then hands back
 * positions that name the wrong code, and probes placed through it would fire
 * for code that did not run. A build composes it to a map that carries
 * nothing, which reads the same as a module of types. Nothing in the composed
 * map says which, so each step is watched as it happens: every other plugin's
 * `transform` is wrapped once the config is resolved, as `vite-plugin-inspect`
 * wraps them, and a step that changed the text without a map is noted. The dev
 * server shares one context across every plugin of a pass, so it is noted
 * there; Rollup hands each plugin its own, so a build notes it by module, and
 * the probes take the note when they read it. `map: null` is the plugin saying
 * it moved nothing, as Rollup reads it, and is believed.
 */

/** A plugin as Vite resolves it, as far as this reads one. */
interface ResolvedPlugin {
  readonly name: string;
  transform?: unknown;
}

type Handler = (this: object, code: string, id: string, ...rest: unknown[]) => unknown;

/** Where a step is noted: on the pass's context under the dev server, by module in a build. */
type Keyed = 'context' | 'module';

const onContext = new WeakMap<object, string[]>();
const byModule = new Map<string, string[]>();
const watched = new WeakSet<object>();

/**
 * Wrap the `transform` of every plugin but `self` in `plugins` so a step that
 * rewrote a module and returned no map is noted, as `keyed` says. Each plugin
 * is wrapped once, however many seams or environments resolve it.
 */
export function watchUnmapped(plugins: readonly ResolvedPlugin[], self: string, keyed: Keyed = 'context'): void {
  for (const plugin of plugins) {
    if (plugin.name === self || plugin.transform === undefined || watched.has(plugin)) continue;
    watched.add(plugin);
    const hook = plugin.transform;
    if (typeof hook === 'function') {
      plugin.transform = wrapped(plugin.name, hook as Handler, keyed);
    } else if (typeof hook === 'object' && hook !== null && typeof (hook as { handler?: unknown }).handler === 'function') {
      // An object hook keeps its `order` and `filter`: only the handler changes.
      const object = hook as { handler: Handler };
      plugin.transform = { ...object, handler: wrapped(plugin.name, object.handler, keyed) };
    }
  }
}

/**
 * The plugins ahead of the caller that rewrote the module without a map: those
 * noted on `context`, and those a build noted for `id`, which this takes.
 */
export function unmappedSteps(context: unknown, id?: string): readonly string[] {
  const shared = typeof context === 'object' && context !== null ? (onContext.get(context) ?? []) : [];
  if (id === undefined) return shared;
  const own = byModule.get(id) ?? [];
  byModule.delete(id);
  return [...shared, ...own.filter((name) => !shared.includes(name))];
}

function wrapped(name: string, handler: Handler, keyed: Keyed): Handler {
  return function (this: object, code, id, ...rest) {
    const result = handler.call(this, code, id, ...rest);
    const list = () => listFor(keyed === 'module' ? id : this);
    if (typeof (result as PromiseLike<unknown> | undefined)?.then === 'function') {
      return (result as PromiseLike<unknown>).then((value) => note(list, name, code, value));
    }
    return note(list, name, code, result);
  };
}

function listFor(key: unknown): string[] | undefined {
  if (typeof key === 'string') {
    const list = byModule.get(key) ?? [];
    byModule.set(key, list);
    return list;
  }
  if (typeof key !== 'object' || key === null) return undefined;
  const list = onContext.get(key) ?? [];
  onContext.set(key, list);
  return list;
}

function note(list: () => string[] | undefined, name: string, code: string, result: unknown): unknown {
  const written = typeof result === 'string' ? result : (result as { code?: unknown } | null | undefined)?.code;
  const map = typeof result === 'string' ? undefined : (result as { map?: unknown } | null | undefined)?.map;
  if (typeof written === 'string' && written !== code && map === undefined) {
    const names = list();
    if (names !== undefined && !names.includes(name)) names.push(name);
  }
  return result;
}
