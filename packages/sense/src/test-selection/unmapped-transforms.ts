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
 * there; Rollup hands each plugin its own, so a build notes it by module, in
 * the notes of the probes that watched the plugin, and the probes take the
 * note when they read it. Two builds in one process each read their own. `map: null` is the plugin saying
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

/** What one watcher noted by module: the steps of one build, or of one server's loads. */
export type UnmappedNotes = Map<string, UnmappedStep[]>;

const onContext = new WeakMap<object, UnmappedStep[]>();
/** The notes each wrapped plugin writes to by module: every watcher's that resolved it. */
const notesOf = new WeakMap<object, Set<UnmappedNotes>>();

/**
 * Wrap the `transform` and `load` of every plugin but `self` in `plugins` so a
 * step that wrote a module and returned no map is noted: a transform as
 * `keyed` says, a load by module, in the notes this answers. Each plugin is
 * wrapped once, however many seams or environments resolve it; one that more
 * than one watcher resolved notes a module for each of them.
 */
export function watchUnmapped(plugins: readonly ResolvedPlugin[], self: string, keyed: Keyed = 'context'): UnmappedNotes {
  const notes: UnmappedNotes = new Map();
  for (const plugin of plugins) {
    if (plugin.name === self) continue;
    const known = notesOf.get(plugin);
    if (known !== undefined) {
      known.add(notes);
      continue;
    }
    const stores = new Set([notes]);
    notesOf.set(plugin, stores);
    for (const hook of ['transform', 'load'] as const) {
      const value = plugin[hook];
      const wrap = (handler: Handler) => (hook === 'load' ? loaded(plugin.name, handler, stores) : wrapped(plugin.name, handler, keyed, stores));
      if (typeof value === 'function') {
        plugin[hook] = wrap(value as Handler);
      } else if (typeof value === 'object' && value !== null && typeof (value as { handler?: unknown }).handler === 'function') {
        // An object hook keeps its `order` and `filter`: only the handler changes.
        const object = value as { handler: Handler };
        plugin[hook] = { ...object, handler: wrap(object.handler) };
      }
    }
  }
  return notes;
}

/**
 * The steps ahead of the caller that wrote the module without a map: those
 * noted on `context`, and those noted in `notes` for `id`, which this takes.
 */
export function unmappedSteps(context: unknown, id: string, notes: UnmappedNotes | undefined): readonly UnmappedStep[] {
  const shared = typeof context === 'object' && context !== null ? (onContext.get(context) ?? []) : [];
  const own = notes?.get(id) ?? [];
  notes?.delete(id);
  return [...shared, ...own.filter((step) => !shared.some((it) => it.plugin === step.plugin))];
}

function wrapped(name: string, handler: Handler, keyed: Keyed, stores: ReadonlySet<UnmappedNotes>): Handler {
  return function (this: object, code, id, ...rest) {
    const result = handler.call(this, code, id, ...rest);
    return settled(result, (value) => {
      const { written, map } = answer(value);
      if (typeof written !== 'string' || written === code || map !== undefined) return;
      if (keyed === 'module') noteModule(stores, id, { plugin: name });
      else push(onContextOf(this), { plugin: name });
    });
  };
}

/** A `load` hook's answer with no map, kept with its text for the probes to hold against the file. */
function loaded(name: string, handler: Handler, stores: ReadonlySet<UnmappedNotes>): Handler {
  return function (this: object, id, ...rest) {
    const result = handler.call(this, id, ...rest);
    return settled(result, (value) => {
      const { written, map } = answer(value);
      if (typeof written === 'string' && map === undefined) noteModule(stores, id, { plugin: name, loaded: written });
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

function noteModule(stores: ReadonlySet<UnmappedNotes>, id: unknown, step: UnmappedStep): void {
  if (typeof id !== 'string') return;
  for (const notes of stores) {
    const list = notes.get(id) ?? [];
    notes.set(id, list);
    push(list, step);
  }
}

function onContextOf(context: unknown): UnmappedStep[] | undefined {
  if (typeof context !== 'object' || context === null) return undefined;
  const list = onContext.get(context) ?? [];
  onContext.set(context, list);
  return list;
}

/**
 * The plugins whose `transform` runs after `self`'s, and so reads its probes:
 * a handler ordered `post` and listed after it. Vite runs every `post` handler
 * after every other, in the order the plugins are listed, so a plugin at
 * `enforce: 'post'` whose handler is not ordered runs ahead of the probes.
 * Vite's and Vitest's own are left out: they read the module to resolve its
 * imports, which the probes do not change.
 */
export function transformsAfter(plugins: readonly ResolvedPlugin[], self: string): readonly string[] {
  const at = plugins.findIndex((plugin) => plugin.name === self);
  if (at === -1) return [];
  return plugins
    .slice(at + 1)
    .filter(({ name, transform }) => {
      const ordered = typeof transform === 'object' && transform !== null && (transform as { order?: unknown }).order === 'post';
      return ordered && name !== self && !/^vite(?:st)?:/.test(name);
    })
    .map(({ name }) => name);
}

/** Warn that the plugins {@link transformsAfter} names read the probes, once for each list of them. */
export function warnTransformsAfter(plugins: readonly ResolvedPlugin[], self: string): void {
  const after = transformsAfter(plugins, self);
  if (after.length === 0) return;
  console.warn(
    `variance-authority: ${after.map((name) => `\`${name}\``).join(', ')} ${after.length === 1 ? 'runs' : 'run'} its \`transform\` after ` +
      `\`${self}\`, ordered \`post\` and listed after it, so ${after.length === 1 ? 'it reads' : 'they read'} the probes. List the probes last.`,
  );
}
