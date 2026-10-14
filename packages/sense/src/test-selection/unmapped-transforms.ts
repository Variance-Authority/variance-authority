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
 * it moved nothing, as Rollup reads it, and is believed. A `load` hook is
 * watched too, by module, and its text kept: whether it rewrote the file is
 * known only against the file on disk, which the probes read.
 */

/** A plugin as Vite resolves it, as far as this reads one. */
interface ResolvedPlugin {
  readonly name: string;
  transform?: unknown;
  load?: unknown;
}

/** A step that wrote a module and returned no map: the plugin, and with `loaded`, the text its `load` hook answered. */
export interface UnmappedStep {
  readonly plugin: string;
  readonly loaded?: string;
}

type Handler = (this: object, code: string, id: string, ...rest: unknown[]) => unknown;

/** Where a step is noted: on the pass's context under the dev server, by module in a build. */
type Keyed = 'context' | 'module';

const onContext = new WeakMap<object, UnmappedStep[]>();
const byModule = new Map<string, UnmappedStep[]>();
const watched = new WeakSet<object>();

/**
 * Wrap the `transform` and `load` of every plugin but `self` in `plugins` so a
 * step that wrote a module and returned no map is noted: a transform as
 * `keyed` says, a load by module. Each plugin is wrapped once, however many
 * seams or environments resolve it.
 */
export function watchUnmapped(plugins: readonly ResolvedPlugin[], self: string, keyed: Keyed = 'context'): void {
  for (const plugin of plugins) {
    if (plugin.name === self || watched.has(plugin)) continue;
    watched.add(plugin);
    for (const hook of ['transform', 'load'] as const) {
      const value = plugin[hook];
      const wrap = (handler: Handler) => (hook === 'load' ? loaded(plugin.name, handler) : wrapped(plugin.name, handler, keyed));
      if (typeof value === 'function') {
        plugin[hook] = wrap(value as Handler);
      } else if (typeof value === 'object' && value !== null && typeof (value as { handler?: unknown }).handler === 'function') {
        // An object hook keeps its `order` and `filter`: only the handler changes.
        const object = value as { handler: Handler };
        plugin[hook] = { ...object, handler: wrap(object.handler) };
      }
    }
  }
}

/**
 * The steps ahead of the caller that wrote the module without a map: those
 * noted on `context`, and those noted for `id`, which this takes.
 */
export function unmappedSteps(context: unknown, id?: string): readonly UnmappedStep[] {
  const shared = typeof context === 'object' && context !== null ? (onContext.get(context) ?? []) : [];
  if (id === undefined) return shared;
  const own = byModule.get(id) ?? [];
  byModule.delete(id);
  return [...shared, ...own.filter((step) => !shared.some((it) => it.plugin === step.plugin))];
}

/** Drop every note taken by module: a build starting again in watch mode loads and transforms afresh. */
export function forgetUnmapped(): void {
  byModule.clear();
}

function wrapped(name: string, handler: Handler, keyed: Keyed): Handler {
  return function (this: object, code, id, ...rest) {
    const result = handler.call(this, code, id, ...rest);
    const list = () => listFor(keyed === 'module' ? id : this);
    return settled(result, (value) => {
      const { written, map } = answer(value);
      if (typeof written === 'string' && written !== code && map === undefined) push(list(), { plugin: name });
    });
  };
}

/** A `load` hook's answer with no map, kept with its text for the probes to hold against the file. */
function loaded(name: string, handler: Handler): Handler {
  return function (this: object, id, ...rest) {
    const result = handler.call(this, id, ...rest);
    return settled(result, (value) => {
      const { written, map } = answer(value);
      if (typeof written === 'string' && map === undefined) push(listFor(id), { plugin: name, loaded: written });
    });
  };
}

function settled(result: unknown, look: (value: unknown) => void): unknown {
  if (typeof (result as PromiseLike<unknown> | undefined)?.then === 'function') {
    return (result as PromiseLike<unknown>).then((value) => (look(value), value));
  }
  look(result);
  return result;
}

function answer(result: unknown): { written: unknown; map: unknown } {
  if (typeof result === 'string') return { written: result, map: undefined };
  const object = result as { code?: unknown; map?: unknown } | null | undefined;
  return { written: object?.code, map: object?.map };
}

function push(list: UnmappedStep[] | undefined, step: UnmappedStep): void {
  if (list !== undefined && !list.some((it) => it.plugin === step.plugin)) list.push(step);
}

function listFor(key: unknown): UnmappedStep[] | undefined {
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
