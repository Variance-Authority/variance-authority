/**
 * The build half of the journal: probes in, inventory out.
 *
 * Everything here runs in whichever process bundles product source, and none
 * of it ever meets the run it is preparing for. That is the split the journal
 * seam exists to bridge, so it is also the split between the two files: this
 * one knows what a block means — its name, its span, the digest of the source
 * it was cut from — and knows nothing about who executed it.
 * {@link EvaluatingPage} and the join live next door.
 */
import { readFileSync } from 'node:fs';
import {
  instrument,
  instrumentationId,
  type InstrumentMode,
  type ModuleId,
} from '../instrument/index.js';
import { readModuleNames } from '../module-names.js';
import {
  cleanId,
  defaultInclude,
  openModuleNames,
  projectPath,
  openRecords,
  recordStore,
  writeRecord,
  type CapturedModule,
} from './instrumented-modules.js';
import { coverageBlock } from './coverage-rows.js';
import { recordedFrame, type TransformSourceMap } from './source-lines.js';
import { repositoryRoot } from './repository-root.js';
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
  /** What the module called itself: its number, or its path until it has one. */
  readonly id: ModuleId;
  readonly hits: readonly number[];
  /**
   * The ordinals among `hits` entered while a module was evaluating: the root,
   * and whatever the top level called. A module evaluates once per realm, in
   * whichever subject's window it was first needed, so these are every
   * subject's and the join gives them to every subject the run drained.
   */
  readonly shared: readonly number[];
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
  /**
   * Separates two bundlers over one repository. Defaults to `build`.
   *
   * A Storybook preview and the application a Playwright suite drives are
   * different builds of overlapping source; one label for both would answer a
   * block ordinal with whichever build wrote its inventory last.
   */
  readonly label?: string;
  /** Where the module records go. Defaults to the repository's cache, `cacheRootFor(root)`. */
  readonly cacheRoot?: string;
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
}

/**
 * What a bundler hands the transform hook as `this`.
 *
 * One method, because one question is asked of it: what did the text arriving
 * here look like before every plugin that ran first. Named rather than imported
 * for the reason the plugin shape below is — a package that has to install Vite
 * to describe two hooks has made Vite a dependency of the recipe.
 */
export interface TransformingContext {
  readonly getCombinedSourcemap: () => TransformSourceMap;
}

/** The subset of Vite's plugin surface this uses, so nothing here needs Vite. */
export interface InstrumentingPlugin {
  readonly name: string;
  readonly enforce: 'post';
  readonly resolveId: (id: string) => string | null;
  readonly load: (id: string) => string | null;
  readonly transform: (
    this: TransformingContext,
    code: string,
    id: string,
  ) => { code: string; map: null } | null;
}

/**
 * The map from the file on disk to the text this hook received, when there is one.
 *
 * A bundler that keeps no chain throws rather than answering, and a build with
 * no prior transform has nothing to answer with. Neither says the text *is* the
 * file — only that nothing here can show where it came from — so `recordedFrame`
 * leaves the extents where the transform left them and digests that same text,
 * rather than vouching for a number line nobody read.
 */
export function priorMap(context: TransformingContext): TransformSourceMap | undefined {
  try {
    const map = context.getCombinedSourcemap();
    return typeof map?.mappings === 'string' ? map : undefined;
  } catch {
    return undefined;
  }
}

const VIRTUAL_COLLECTOR = 'variance-authority:execution-collector';
const RESOLVED_COLLECTOR = `\0${VIRTUAL_COLLECTOR}`;

/**
 * Instrument a build and write down what its ordinals mean.
 *
 * ```js
 * // .storybook/main.js
 * import { testSelectionProbes } from '@variance-authority/sense/journal';
 *
 * export default {
 *   viteFinal: (config) => ({
 *     ...config,
 *     plugins: [...config.plugins, testSelectionProbes({ label: 'storybook' })],
 *   }),
 * };
 * ```
 *
 * `enforce: 'post'` for the reason the Vitest seam has it: probes land on JS
 * after TypeScript is stripped, so nothing here parses a syntax `oxc` would have
 * to be taught.
 */
export function testSelectionProbes(
  options: TestSelectionProbeOptions = {},
): InstrumentingPlugin {
  const root = repositoryRoot(options.root ?? process.cwd());
  const include = options.include ?? defaultInclude;

  // One record per module, written as that module is transformed. A dev server
  // has no end to write at: a Playwright suite drives a server that keeps
  // transforming for the whole life of the run, and a driver draining the page
  // needs the record for what it just executed. A build with a warm cache has no
  // end either, in the sense that matters — it never holds the modules it did
  // not transform, so it must never write a document that claims to.
  const instrumentation = instrumentationId(options.mode);
  const records = openRecords(recordStore(root, options.label, options.cacheRoot), instrumentation);
  const persist = (captured: CapturedModule): void => {
    writeRecord(records, captured);
  };

  // Once, here, rather than per module: the table is immutable while this build
  // runs, and the fold that grows it runs after. A file it has never numbered is
  // instrumented under its path and numbered by the next fold.
  const names = readModuleNames(openModuleNames(root, options.cacheRoot));

  return {
    name: 'variance-authority:test-selection-probes',
    enforce: 'post',
    resolveId: (id) => (id === VIRTUAL_COLLECTOR || id === RESOLVED_COLLECTOR ? RESOLVED_COLLECTOR : null),
    load: (id) => (id === RESOLVED_COLLECTOR ? executionCollectorSource(options.mode) : null),

    transform(code, specifier) {
      const source = cleanId(specifier);
      if (source === RESOLVED_COLLECTOR || !include(source)) return null;
      // The digest and the lines from one decision, so they cannot describe two
      // texts: the file on disk when the prior chain reads the extents back into
      // it, and `code` when there is no chain and the extents stay where the
      // transform left them.
      const { lineOf, sourceDigest, file: wrote } = recordedFrame(
        code,
        priorMap(this),
        source,
        (at) => readFileSync(at, 'utf8'),
      );

      // Instrumented under its id, which is all the page then reports. The path
      // is repository-relative: a journal that named absolute paths would be a
      // journal from the build machine's disk — unreadable on a driver that
      // mounted the checkout somewhere else, and a leak of a layout nobody asked
      // for. It rides in the record, once, rather than in every copy of the
      // module the bundle ships.
      const file = projectPath(root, wrote);
      const id = names.idOf(file) ?? file;
      const done = instrument(code, file, id, options.mode === undefined ? {} : { mode: options.mode });
      if (done === undefined) {
        persist({ file, id, sourceDigest, instrumented: false, blocks: [] });
        return null;
      }

      persist({
        file,
        id,
        sourceDigest,
        instrumented: true,
        blocks: done.blocks.map((block) => coverageBlock(code, block, lineOf)),
      });

      // Hoisted in front of everything the module imports, and on the first line,
      // so line numbers survive the way every other insertion in this package
      // preserves them. An instrumented module whose collector arrived late would
      // throw at its own module probe.
      return { code: `import ${JSON.stringify(VIRTUAL_COLLECTOR)};${done.code}`, map: null };
    },
  };
}

/**
 * The page half, as source, because it has to cross `page.evaluate` or a bundler.
 *
 * The engine is `instrument/probe-log.cts`, sent as its own source, so a page records
 * with the code a test runner records with. A page has one bucket and never
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
      const modules = engine.lists(engine.take(bucket), true);
      return { instrumentation: ${JSON.stringify(instrumentation)}, modules };
    },
    reset() {
      engine.take(bucket);
    },
  };
}
`;
}
