/**
 * The build half of the journal: probes in.
 *
 * Everything here runs in whichever process bundles product source, and none
 * of it ever meets the run it is preparing for. Nothing has to: the probes
 * report the file and the text they were placed on, and the join next door
 * cuts that text again to learn what each ordinal means.
 */
import { instrumentationId, type InstrumentMode, type ModuleId } from '../instrument/index.js';
import { probesRegions } from '../instrument/identity.js';
import { readFileSync } from 'node:fs';
import { captureAfter, heldOriginal, type ComposedMap, placeModule } from './captured-modules.js';
import { cleanId, defaultInclude, fileOrNone, mayTake, type ProbePlacement } from './instrumented-modules.js';
import { repositoryRoot } from './repository-root.js';
import { builtMap, handedTexts, namesItsMap } from './source-lines.js';
import { type UnmappedNotes, refuseTransformsAfter, unmappedSteps, watchUnmapped } from './unmapped-transforms.js';
import probeLists from '../instrument/probe-lists.cjs';
import probeLog from '../instrument/probe-log.cjs';

/**
 * Where a page hands its journal over.
 *
 * Deliberately not a short name: this shares a global namespace with whatever
 * application the page already loaded, and a collision would be discovered as a
 * confusing selection rather than as an error.
 */
export const EXECUTION_GLOBAL = '__variance_authority_execution__';

/** What one module reported: the ordinals it entered, deduplicated. */
export interface ExecutedModule {
  /** What the module called itself: its path and the digest of its text, `path@digest`. */
  readonly id: ModuleId;
  readonly hits: readonly number[];
  /**
   * The ordinals among `hits` entered while a module was evaluating: the root,
   * and whatever the top level called. A module evaluates once per realm, in
   * whichever subject's window it was first needed, so these are every
   * subject's and the join gives them to every subject the run drained.
   */
  readonly shared: readonly number[];
  /**
   * The ordinals among `shared` entered again once no module was evaluating:
   * a function the top level called and the subject called afterwards. The
   * subject earned these as it would had the module evaluated before its
   * window opened. Absent where nothing was entered both ways.
   */
  readonly again?: readonly number[];
}

/** Everything a page entered between two drains. */
export interface ExecutionJournal {
  readonly instrumentation: string;
  readonly modules: readonly ExecutedModule[];
}

/** What the collector exposes on {@link EXECUTION_GLOBAL}. */
export interface ExecutionCollector {
  readonly version: 1;
  readonly instrumentation: string;
  /** Everything entered since the previous drain. Empties the log. */
  readonly drain: () => ExecutionJournal;
  /** Forget everything entered so far without reporting it. */
  readonly reset: () => void;
}

export interface TestSelectionProbeOptions {
  /**
   * A directory inside the repository; defaults to the current directory.
   * Names are relative to the checkout it sits in, never to it.
   */
  readonly root?: string;
  /** Decide which transformed modules are product source. */
  readonly include?: (file: string) => boolean;
  /** The journey head this build installs, with `journeys`. Defaults to `build`. */
  readonly label?: string;
  /**
   * `presence` probes every arrival region; `entries` probes modules and
   * functions only, and costs a fraction of it.
   *
   * It is the same choice the Vitest and Jest seams offer, and it has to be
   * the same *answer* in a repository whose seams share a coverage file: a
   * snapshot names the recipe its ordinals were cut by, and a merge discards
   * a layer cut by another one. Two seams recording one index under two modes
   * would each wipe the other every run.
   */
  readonly mode?: InstrumentMode;
  /**
   * Where the probes go. `after-transforms`, the default, runs at
   * `enforce: 'post'` and places them through the composed map;
   * `before-transforms` runs at `enforce: 'pre'` and places them in the file
   * as read, one parse and no map, for a build whose transforms only strip
   * types or JSX: a compiler that reads syntax then reads the probes.
   */
  readonly placement?: ProbePlacement;
  /**
   * Install the journey head before anything this build instrumented runs.
   *
   * For a service bundle, such as a Worker, whose modules are all evaluated
   * before any of its own code could call `collectJourneys()` first. The
   * collector imports `@variance-authority/sense/journey` and installs the
   * head under this build's `label`, told where to write by
   * `VARIANCE_AUTHORITY_PARTS`; the service's own `collectJourneys()` returns
   * that head to wrap its requests.
   */
  readonly journeys?: boolean;
}

/** The part of a Vite transform's context this reads. */
export interface InstrumentingContext {
  readonly getCombinedSourcemap?: () => ComposedMap;
}

/** The map a transform returns: Vite's `SourceMapInput`, one source. */
export interface InstrumentedMap {
  readonly version: 3;
  readonly sources: readonly string[];
  readonly names: readonly string[];
  readonly mappings: string;
}

/** The subset of Vite's plugin surface this uses, so nothing here needs Vite. */
export interface InstrumentingPlugin {
  readonly name: string;
  readonly enforce: 'pre' | 'post';
  /** The options it was made with, for a plugin that has to keep it rather than add a second. */
  readonly api: { readonly options: TestSelectionProbeOptions };
  /** Watch every other plugin for a rewrite with no map: {@link watchUnmapped}. */
  readonly configResolved: (config: {
    readonly command: string;
    readonly plugins: readonly { readonly name: string; transform?: unknown; load?: unknown }[];
  }) => void;
  /**
   * Turn a build's source maps on where it writes none, after every other
   * plugin's `config`: Vite's own `vite:define` hands its map on only where
   * the build writes maps.
   */
  readonly config: {
    readonly order: 'post';
    readonly handler: (
      config: { readonly build?: { readonly sourcemap?: unknown } },
      env: { readonly command: string },
    ) => { build: { sourcemap: 'hidden' } } | undefined;
  };
  /** Forget what an earlier build in watch mode noted. */
  readonly buildStart: () => void;
  /** Take back the `.map` files a build wrote only because {@link config} turned its maps on. */
  readonly generateBundle: (options: unknown, bundle: Record<string, unknown>) => void;
  readonly resolveId: (id: string) => string | null;
  readonly load: (id: string) => string | { code: string; map: object | null } | null;
  /**
   * Ordered `post` after the transforms, so a plain `transform` at
   * `enforce: 'post'` runs ahead of it wherever it is listed; ordered `pre`
   * ahead of them.
   */
  readonly transform: {
    readonly order: 'pre' | 'post';
    readonly handler: (
      this: unknown,
      code: string,
      id: string,
    ) => { code: string; map: InstrumentedMap | null } | null;
  };
}

const VIRTUAL_COLLECTOR = 'variance-authority:execution-collector';
const RESOLVED_COLLECTOR = `\0${VIRTUAL_COLLECTOR}`;
/** What every probed module ends with: an import, hoisted, so the collector loads ahead of its probes. */
const COLLECTOR = `\n;import ${JSON.stringify(VIRTUAL_COLLECTOR)};`;

/**
 * The Vite plugin whose `transform` hook instruments each module of a build.
 *
 * ```js
 * // vite.config.ts
 * import { testSelectionProbes } from '@variance-authority/sense/journal';
 *
 * export default {
 *   plugins: [testSelectionProbes()],
 * };
 * ```
 *
 * A Storybook takes it through `@variance-authority/storybook-collector` in
 * its `addons`, which adds it under Vite.
 *
 * `enforce: 'post'`, so no transform of the project's reads a probe: a
 * compiler that reads syntax — a CSS-in-JS extractor, a memoising compiler —
 * would refuse probed code, or compile it into something the project does not
 * ship. The regions are still the file's as it is on disk,
 * the text the join cuts again and a diff is written against; the composed
 * map says where each one's code went, and a region it carries nowhere fires
 * when the module loads. A `vite build` that writes no map has its maps turned
 * on for the transforms, `hidden`, and every `.map` file taken back out of the
 * bundle, so what it writes is what it wrote before. A plugin that rewrote the file and returned no map
 * stops the build, and the dev server, by name. `placement:
 * 'before-transforms'` runs it at `enforce: 'pre'` instead, on the file as
 * read, and none of that applies.
 */
export function testSelectionProbes(
  options: TestSelectionProbeOptions = {},
): InstrumentingPlugin {
  const root = repositoryRoot(options.root ?? process.cwd());
  const include = options.include ?? defaultInclude;
  const before = options.placement === 'before-transforms';

  const name = 'variance-authority:test-selection-probes';
  let serving = false;
  /** The modules a dev server loaded probed, because their files name their own maps. */
  const first = new Set<string>();
  /**
   * The file a dev server's `load` read for each module, until its transform
   * takes it: a module is read from disk once. Taken by the transform, and
   * dropped when a build starts again, so nothing is held from one to the next.
   */
  const held = new Map<string, string>();
  /** What the plugins this build watches noted by module, its own and no other build's. */
  let notes: UnmappedNotes | undefined;
  /** Whether this build writes maps only because the probes turned them on. */
  let mapsOurs = false;
  return {
    name,
    enforce: before ? 'pre' : 'post',
    api: { options },
    // `hidden`, so no bundle names a map, and every `.map` it writes is taken back below.
    config: { order: 'post', handler: (config, env) => {
      mapsOurs = !before && env.command === 'build' && !config.build?.sourcemap;
      return mapsOurs ? { build: { sourcemap: 'hidden' } } : undefined;
    } },
    // A build hands each plugin its own context, so a step is noted by module there.
    configResolved: (config) => {
      serving = config.command === 'serve';
      // Ahead of every transform, no map is read, so no step is watched for one.
      if (before) return;
      notes = watchUnmapped(config.plugins, name, serving ? 'context' : 'module');
      refuseTransformsAfter(config.plugins, name);
    },
    // A build in watch mode starts again: what an earlier one noted is stale.
    buildStart: () => {
      notes?.clear();
      held.clear();
    },
    generateBundle: (_options, bundle) => {
      if (!mapsOurs) return;
      // The maps of what the build wrote, each named after its file; a `.map` another plugin emits stays.
      for (const file of Object.keys(bundle)) if (!file.endsWith('.map')) delete bundle[`${file}.map`];
    },
    resolveId: (id) => (id === VIRTUAL_COLLECTOR || id === RESOLVED_COLLECTOR ? RESOLVED_COLLECTOR : null),
    load: (id) => {
      if (id !== RESOLVED_COLLECTOR) return serving && !before ? probedFirst(id) : null;
      const collector = executionCollectorSource(options.mode);
      if (options.journeys !== true) return collector;
      // Imports evaluate first, so the head owns `__VA__` before this module's
      // page engine looks, and the page engine defers to it.
      const head = JSON.stringify({ head: options.label ?? 'build' });
      return `import { collectJourneys } from "@variance-authority/sense/journey";\ncollectJourneys(${head});\n${collector}`;
    },

    transform: { order: before ? 'pre' : 'post', handler(code, specifier) {
      const source = cleanId(specifier);
      if (source === RESOLVED_COLLECTOR) return null;
      if (before) {
        // The collector import follows the last line, as below, so no line moves.
        const captured = placeModule(root, source, code, include, undefined, options.mode);
        return captured === undefined ? null : { code: `${captured.code}${COLLECTOR}`, map: null };
      }
      const text = held.get(specifier);
      held.delete(specifier);
      if (first.delete(specifier)) return { code: `${code}${COLLECTOR}`, map: null };
      // Vite hands every transform its context; a caller that calls this by hand has none.
      const context = this as InstrumentingContext | undefined;
      const combined = context?.getCombinedSourcemap;
      const map = typeof combined === 'function' ? () => combined.call(context) : undefined;
      const captured = captureAfter(root, source, code, include, options.mode, map, {
        unmapped: unmappedSteps(context, specifier, notes),
        variant: specifier !== source,
        original: heldOriginal(source, text),
      });
      if (captured === undefined) return null;

      // After the last line, so no position in the module moves and its
      // directive prologue stays first: `"use client"` is a directive only
      // there. An import is hoisted from wherever it is written, so the
      // collector still evaluates before this module's body, which is where its
      // first probe is. The module's other imports evaluate first, and every
      // one of them that carries a probe imports the collector itself.
      return {
        code: `${captured.code}${COLLECTOR}`,
        map: captured.mappings === undefined ? null : { version: 3, sources: [source], names: [], mappings: captured.mappings },
      };
    } },
  };

  /**
   * A file that names its own map, a build's output, loaded probed by a dev
   * server. A dev server starts the composed map from that map, so it names
   * the build's sources and never the file, and no placement after the
   * transforms could join the file's regions; a build starts from the file's
   * text, and places it after them as it does every module. The probed text
   * is the one a dev server hands its plugins, with the comment blanked, and
   * the file's own map goes on with it, as the dev server would have read it.
   */
  function probedFirst(id: string): { code: string; map: object | null } | null {
    const file = cleanId(id);
    // Under `node_modules`, `include` is asked first: no map there is read.
    if (id !== file || !mayTake(file, include)) return null;
    const disk = fileOrNone(file, (path) => readFileSync(path, 'utf8'));
    if (disk === undefined) return null;
    if (!namesItsMap(disk)) {
      held.set(id, disk);
      return null;
    }
    const captured = placeModule(root, file, handedTexts(disk).at(-1)!, include, undefined, options.mode, heldOriginal(file, disk));
    if (captured === undefined) return null;
    first.add(id);
    return { code: captured.code, map: builtMap(disk, file, (path) => readFileSync(path, 'utf8')) ?? null };
  }
}

/**
 * The page half, as source, because it has to cross `page.evaluate` or a bundler.
 *
 * The engine is `instrument/probe-log.cts`, sent as its own source with
 * `instrument/probe-lists.cts`, so a page records with the code a test runner
 * records with. A page has one bucket and never
 * switches it: a drain reads it out and empties it in place.
 *
 * `globalThis.__VA__` keeps its identity for the life of the page, because
 * every module reads it once and keeps it, and the drain on
 * {@link EXECUTION_GLOBAL} is the one installed with it.
 */
export function executionCollectorSource(mode?: InstrumentMode): string {
  const instrumentation = instrumentationId(mode);
  return `
const engine = (${probeLog.createEngine.toString()})(false);
const lists = ${probeLists.lists.toString()};
const bucket = engine.open('');
engine.use(bucket);
// Under \`loads\` the mark is the only signal, and a page reused between
// subjects evaluates a module once: each drain leaves the modules the page
// holds in the bucket, so the next subject is charged with them too.
const carries = ${JSON.stringify(!probesRegions(mode))};
// A realm that already has a root has a collector that knows more than this
// one: a Node head keys its buckets by journey, and a page has nowhere to put a
// caller. Deferring is what lets one instrumented build serve a page and a
// service. The drain goes with the root: a collector that deferred holds a
// bucket nothing writes to, so a second bundle on one page offering its own
// would have the page report that it ran nothing.
if (globalThis.__VA__ === undefined) {
  globalThis.__VA__ = engine.root;
  globalThis[${JSON.stringify(EXECUTION_GLOBAL)}] = {
    version: 1,
    instrumentation: ${JSON.stringify(instrumentation)},
    drain() {
      // In the order the page first registered each module, drain after drain.
      const modules = lists(engine.take(bucket), true);
      if (carries) engine.carry();
      return { instrumentation: ${JSON.stringify(instrumentation)}, modules };
    },
    reset() {
      engine.take(bucket);
      if (carries) engine.carry();
    },
  };
}
`;
}
