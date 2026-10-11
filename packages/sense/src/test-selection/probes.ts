/**
 * The build half of the journal: probes in.
 *
 * Everything here runs in whichever process bundles product source, and none
 * of it ever meets the run it is preparing for. Nothing has to: the probes
 * report the file and the text they were placed on, and the join next door
 * cuts that text again to learn what each ordinal means.
 */
import { instrumentationId, type InstrumentMode, type ModuleId } from '../instrument/index.js';
import { captureModule } from './captured-modules.js';
import { cleanId, defaultInclude } from './instrumented-modules.js';
import { repositoryRoot } from './repository-root.js';
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

/** The subset of Vite's plugin surface this uses, so nothing here needs Vite. */
export interface InstrumentingPlugin {
  readonly name: string;
  readonly enforce: 'pre';
  readonly resolveId: (id: string) => string | null;
  readonly load: (id: string) => string | null;
  readonly transform: (code: string, id: string) => { code: string; map: null } | null;
}

const VIRTUAL_COLLECTOR = 'variance-authority:execution-collector';
const RESOLVED_COLLECTOR = `\0${VIRTUAL_COLLECTOR}`;

/**
 * Instrument a build.
 *
 * ```js
 * // .storybook/main.js
 * import { testSelectionProbes } from '@variance-authority/sense/journal';
 *
 * export default {
 *   viteFinal: (config) => ({
 *     ...config,
 *     plugins: [...config.plugins, testSelectionProbes()],
 *   }),
 * };
 * ```
 *
 * `enforce: 'pre'` for the reason the Vitest seam has it: probes land on the
 * file as it is on disk, which is the text the join cuts again and the text a
 * diff is written against, and every transform after it carries the probes
 * along with the code they sit in.
 */
export function testSelectionProbes(
  options: TestSelectionProbeOptions = {},
): InstrumentingPlugin {
  const root = repositoryRoot(options.root ?? process.cwd());
  const include = options.include ?? defaultInclude;

  return {
    name: 'variance-authority:test-selection-probes',
    enforce: 'pre',
    resolveId: (id) => (id === VIRTUAL_COLLECTOR || id === RESOLVED_COLLECTOR ? RESOLVED_COLLECTOR : null),
    load: (id) => {
      if (id !== RESOLVED_COLLECTOR) return null;
      const collector = executionCollectorSource(options.mode);
      if (options.journeys !== true) return collector;
      // Imports evaluate first, so the head owns `__VA__` before this module's
      // page engine looks, and the page engine defers to it.
      const head = JSON.stringify({ head: options.label ?? 'build' });
      return `import { collectJourneys } from "@variance-authority/sense/journey";\ncollectJourneys(${head});\n${collector}`;
    },

    transform(code, specifier) {
      const source = cleanId(specifier);
      if (source === RESOLVED_COLLECTOR) return null;
      const captured = captureModule(root, source, code, include, options.mode);
      if (captured?.code === undefined) return null;

      // Hoisted in front of everything the module imports, and on the first line,
      // so line numbers survive the way every other insertion in this package
      // preserves them. An instrumented module whose collector arrived late would
      // throw at its own module probe.
      return { code: `import ${JSON.stringify(VIRTUAL_COLLECTOR)};${captured.code}`, map: null };
    },
  };
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
      return { instrumentation: ${JSON.stringify(instrumentation)}, modules };
    },
    reset() {
      engine.take(bucket);
    },
  };
}
`;
}
