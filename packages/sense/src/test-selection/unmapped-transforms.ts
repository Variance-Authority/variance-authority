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
 * note when they read it. Two builds in one process each read their own.
 * `map: null` is the plugin saying it moved nothing, as Rollup reads it, and is
 * believed where no line moved: the line count is the file's, or the text was
 * only appended to. One that moved lines is noted. A `load` hook is
 * watched too, by module, and its text kept: whether it rewrote the file is
 * known only against the file on disk, which the probes read.
 */

import { afterHook, type AfterHook, type HookedPlugin } from './plugin-hooks.js';

/**
 * A step that wrote a module and returned no map: the plugin, with `loaded`
 * the text its `load` hook answered, and with `nulled` a `transform` that
 * answered `map: null` and moved lines.
 */
export interface UnmappedStep {
  readonly plugin: string;
  readonly loaded?: string;
  readonly nulled?: boolean;
}

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
export function watchUnmapped(plugins: readonly HookedPlugin[], self: string, keyed: Keyed = 'context'): UnmappedNotes {
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
    afterHook(plugin, 'transform', transformed(plugin.name, keyed, stores));
    afterHook(plugin, 'load', loaded(plugin.name, stores));
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

function transformed(name: string, keyed: Keyed, stores: ReadonlySet<UnmappedNotes>): AfterHook {
  return function (this: object, value, [code, id]) {
    const { written, map } = answer(value);
    if (typeof written !== 'string' || written === code) return value;
    if (map !== undefined && map !== null) return value;
    if (map === null && !movesLines(code as string, written)) return value;
    const step = map === null ? { plugin: name, nulled: true } : { plugin: name };
    if (keyed === 'module') noteModule(stores, id as string, step);
    else push(onContextOf(this), step);
    return value;
  };
}

/**
 * Whether `written` moved a line of `code`: its line count differs, and it is
 * not `code` with text after it. A rewrite within the lines, or an append, moves
 * none, so `map: null` there is believed.
 */
function movesLines(code: string, written: string): boolean {
  return lineCount(written) !== lineCount(code) && !written.startsWith(code);
}

function lineCount(text: string): number {
  let count = 1;
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) count++;
  return count;
}

/** A `load` hook's answer with no map, kept with its text for the probes to hold against the file. */
function loaded(name: string, stores: ReadonlySet<UnmappedNotes>): AfterHook {
  return function (value, [id]) {
    const { written, map } = answer(value);
    if (typeof written === 'string' && map === undefined) noteModule(stores, id as string, { plugin: name, loaded: written });
    return value;
  };
}

function answer(result: unknown): { written: unknown; map: unknown } {
  if (typeof result === 'string') return { written: result, map: undefined };
  const object = result as { code?: unknown; map?: unknown } | null | undefined;
  return { written: object?.code, map: object?.map };
}

function push(list: UnmappedStep[], step: UnmappedStep): void {
  if (!list.some((it) => it.plugin === step.plugin)) list.push(step);
}

function noteModule(stores: ReadonlySet<UnmappedNotes>, id: string, step: UnmappedStep): void {
  for (const notes of stores) {
    const list = notes.get(id) ?? [];
    notes.set(id, list);
    push(list, step);
  }
}

function onContextOf(context: object): UnmappedStep[] {
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
export function transformsAfter(plugins: readonly HookedPlugin[], self: string): readonly string[] {
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

/**
 * Stop the run where a plugin {@link transformsAfter} names reads the probes:
 * the compiler the probes go in after would read them again, which is the
 * failure placing them last exists to prevent.
 */
export function refuseTransformsAfter(plugins: readonly HookedPlugin[], self: string): void {
  const after = transformsAfter(plugins, self);
  if (after.length === 0) return;
  const one = after.length === 1;
  throw new Error(
    `variance-authority: ${after.map((name) => `\`${name}\``).join(', ')} ${one ? 'runs its' : 'run their'} \`transform\` after ` +
      `\`${self}\`, ordered \`post\` and listed after it, so ${one ? 'it reads' : 'they read'} the probes: ` +
      `move ${one ? 'it' : 'them'} ahead of the probes, or set \`placement: 'before-transforms'\`.`,
  );
}
