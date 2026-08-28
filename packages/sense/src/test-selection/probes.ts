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
import { resolve } from 'node:path';
import { digestString } from '@variance-authority/core';
import { INSTRUMENTATION_ID, instrument } from '../instrument/index.js';
import {
  cleanId,
  coverageBlock,
  defaultInclude,
  instrumentedModulesFile,
  projectPath,
  writeInstrumentedModules,
  type CapturedModule,
} from './instrumented-modules.js';

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
  readonly file: string;
  readonly hits: readonly number[];
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
  /** Everything entered since the previous drain. Zeroes the counters. */
  readonly drain: () => ExecutionJournal;
  /** Forget everything entered so far without reporting it. */
  readonly reset: () => void;
}

export interface TestSelectionProbeOptions {
  /** Repository root. Defaults to the current directory. */
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
  /** Persisted block inventory. Defaults to the repository-keyed user cache. */
  readonly modulesFile?: string;
}

/** The subset of Vite's plugin surface this uses, so nothing here needs Vite. */
export interface InstrumentingPlugin {
  readonly name: string;
  readonly enforce: 'post';
  readonly resolveId: (id: string) => string | null;
  readonly load: (id: string) => string | null;
  readonly transform: (code: string, id: string) => { code: string; map: null } | null;
  readonly buildEnd: () => Promise<void>;
  readonly closeBundle: () => Promise<void>;
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
  const root = resolve(options.root ?? process.cwd());
  const file =
    options.modulesFile === undefined
      ? instrumentedModulesFile(root, options.label)
      : resolve(root, options.modulesFile);
  const include = options.include ?? defaultInclude;
  const modules = new Map<string, CapturedModule>();
  let written: Promise<void> = Promise.resolve();

  // Written as the build proceeds rather than only at its end, because a dev
  // server has no end: a Playwright suite drives a server that transforms
  // modules for the whole life of the run, and a driver draining the page needs
  // the inventory for what it just executed, not for what a build finished with.
  const persist = (): void => {
    written = written.then(() => writeInstrumentedModules(file, [...modules.values()]));
  };

  return {
    name: 'variance-authority:test-selection-probes',
    enforce: 'post',
    resolveId: (id) => (id === VIRTUAL_COLLECTOR || id === RESOLVED_COLLECTOR ? RESOLVED_COLLECTOR : null),
    load: (id) => (id === RESOLVED_COLLECTOR ? executionCollectorSource() : null),

    transform(code, id) {
      const source = cleanId(id);
      if (source === RESOLVED_COLLECTOR || !include(source)) return null;

      // Instrumented under its repository-relative name, which is what the page
      // then reports. A journal that named absolute paths would be a journal
      // from the build machine's disk — unreadable on a driver that mounted the
      // checkout somewhere else, and a leak of a layout nobody asked for.
      const file = projectPath(root, source);
      const done = instrument(code, file);
      if (done === undefined) {
        modules.set(source, {
          file,
          sourceDigest: digestString(code),
          instrumented: false,
          blocks: [],
        });
        persist();
        return null;
      }

      modules.set(source, {
        file,
        sourceDigest: done.sourceDigest,
        instrumented: true,
        blocks: done.blocks.map((block) => coverageBlock(code, block)),
      });
      persist();

      // Hoisted in front of everything the module imports, and on the first line,
      // so line numbers survive the way every other insertion in this package
      // preserves them. An instrumented module whose collector arrived late would
      // throw at its own module probe.
      return { code: `import ${JSON.stringify(VIRTUAL_COLLECTOR)};${done.code}`, map: null };
    },

    async buildEnd(): Promise<void> {
      persist();
      await written;
    },

    async closeBundle(): Promise<void> {
      await written;
    },
  };
}

/**
 * The page half, as source, because it has to cross `page.evaluate` or a bundler.
 *
 * `globalThis.__VA__` keeps its identity for the life of the page: the emitted
 * probe caches its counter array and re-resolves only when the factory changes,
 * so a reset that replaced the factory would cost every module a re-registration
 * — and a module that never runs again would never re-register at all.
 */
export function executionCollectorSource(): string {
  return `
const modules = new Map();
const factory = (file, count) => {
  let counters = modules.get(file);
  if (counters === undefined || counters.length !== count) {
    counters = new Uint32Array(count);
    modules.set(file, counters);
  }
  return counters;
};
globalThis.__VA__ = factory;
globalThis[${JSON.stringify(EXECUTION_GLOBAL)}] = {
  version: 1,
  instrumentation: ${JSON.stringify(INSTRUMENTATION_ID)},
  drain() {
    const entered = [];
    for (const [file, counters] of modules) {
      const hits = [];
      for (let ordinal = 0; ordinal < counters.length; ordinal += 1) {
        if (counters[ordinal] > 0) {
          hits.push(ordinal);
          counters[ordinal] = 0;
        }
      }
      if (hits.length > 0) entered.push({ file, hits });
    }
    return { instrumentation: ${JSON.stringify(INSTRUMENTATION_ID)}, modules: entered };
  },
  reset() {
    for (const counters of modules.values()) counters.fill(0);
  },
};
`;
}
