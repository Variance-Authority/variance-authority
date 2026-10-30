/**
 * The plugins `withTestSelection` adds to a Vitest configuration: the cut of
 * each test file, on the file as it is on disk, and the probes, on what every
 * transform wrote from it.
 */

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { cadence, type CutSourceMap } from '../instrument/cadence.js';
import type { InstrumentMode } from '../instrument/index.js';
import { heldOriginal, pathOf, type Captured, type CapturedAfter, type ComposedMap } from './captured-modules.js';
import { cleanId, fileOrNone, mayTake, projectPath, type ProbePlacement } from './instrumented-modules.js';
import { readFinished, type FinishedFile } from './finished-files.js';
import { browserSetupSource } from './worker-source.js';
import { declareConfig, type ResolvedViteConfig } from './governing-config.js';
import { removeSeamModules, writeSeamModule, type SelectionRun } from './selection-run.js';
import { handedTexts, namesItsMap } from './source-lines.js';
import { type UnmappedNotes, type UnmappedStep, refuseTransformsAfter, unmappedSteps, watchUnmapped } from './unmapped-transforms.js';
import { readCommandLine, seedInBanner, type BannerContext } from './vitest-sequencer.js';

export interface ConfigPlugin {
  readonly name: string;
  readonly configResolved: (config: ResolvedViteConfig) => void;
}

/** The part of the configuration Vite hands a plugin that decides where a file runs, and how files are ordered. */
interface TestConfig {
  test?: { browser?: { enabled?: boolean }; runner?: string; sequence?: { sequencer?: unknown } };
}

interface VitePlugin extends ConfigPlugin {
  readonly enforce: 'pre';
  readonly config: (config: TestConfig) => Promise<void>;
  readonly transform: {
    readonly order: 'pre';
    readonly handler: (code: string, id: string) => { code: string; map: CutSourceMap | null } | null;
  };
  readonly closeBundle: () => Promise<void>;
  readonly watchChange: (id: string) => void;
  /** Vitest 3.1 and on call it with the run's context; Vitest 2 and 3.0 never do. */
  readonly configureVitest: (context: VitestContext) => void;
}

/**
 * What Vitest hands `configureVitest`. A key generator is how a plugin keeps a
 * module out of the file-system module cache: `defineCacheKeyGenerator` from
 * Vitest 5, `experimental_defineCacheKeyGenerator` on 4.1, neither before.
 */
interface VitestContext {
  readonly vitest: BannerContext;
  readonly defineCacheKeyGenerator?: (generate: (context: { readonly id: string }) => string | undefined | false) => void;
  readonly experimental_defineCacheKeyGenerator?: VitestContext['defineCacheKeyGenerator'];
}

/** The plugin that places the probes, last; Vite hands its transform the map it composed. */
interface ProbesPlugin {
  readonly name: string;
  readonly enforce: 'post';
  readonly configResolved: (config: ResolvedViteConfig) => void;
  readonly transform: {
    readonly order: 'post';
    readonly handler: (
      this: { getCombinedSourcemap(): ComposedMap },
      code: string,
      id: string,
    ) => { code: string; map: { version: 3; sources: string[]; names: string[]; mappings: string } | null } | null;
  };
}


export function selectionPlugin(
  root: string,
  setupId: string,
  runnerId: string,
  globalSetup: ReadonlySet<string>,
  run: SelectionRun,
  taken: { readonly include: (file: string) => boolean; readonly unprobed: ((file: string) => boolean) | undefined },
  { capture, after }: {
    readonly capture: (file: string, code: string, original: (at: string) => string) => Captured | undefined;
    readonly after: (
      file: string,
      code: string,
      map: () => ComposedMap,
      unmapped: readonly UnmappedStep[],
      variant: boolean,
      original: (at: string) => string,
    ) => CapturedAfter | undefined;
  },
  mode: InstrumentMode,
  declared: readonly string[],
  settle: (files: readonly FinishedFile[]) => Promise<void>,
  cut: ((file: string) => boolean) | undefined,
  placement: ProbePlacement,
  story?: string,
): [VitePlugin, ProbesPlugin] {
  const { modules } = run;
  let closing: Promise<void> | undefined;
  let inPage = false;
  /** Probes go in ahead of every transform, here, and the probes plugin passes every module by. */
  const before = placement === 'before-transforms';
  /** The modules of this seam's own, and a `globalSetup` file, which no probe may sit in. */
  const own = (file: string): boolean => file === setupId || file === runnerId || globalSetup.has(file);
  /**
   * A file the transforms may read and probe; the module cache is kept from the
   * same ones. Read from this configuration's own predicates: the run's are
   * shared by every project in it.
   */
  const takes = (file: string): boolean => mayTake(file, (at) => taken.include(at) || taken.unprobed?.(at) === true);
  /**
   * A test file the run cuts: the file itself only, since a query asks for a
   * module built from it. A page records no case, but its story still says
   * which test line ran.
   */
  const cutting = (id: string, file: string): boolean =>
    cut !== undefined && id === file && (run.cases || story !== undefined) && cut(file);
  /** The modules probed first because their files name their own maps, until the probes plugin passes them by. */
  const first = new Set<string>();
  /**
   * The file each module's cut read, by module, until the probes take it: a
   * module is read from disk once. Taken when the probes reach the module, and
   * dropped when its file changes, so nothing is held from one run to the next.
   */
  const held = new Map<string, string>();
  /** What the plugins ahead of the probes noted by module: each `load` with no map. */
  let notes: UnmappedNotes | undefined;
  return [{
    name: 'variance-authority:test-selection',
    // First, for the test files the run cuts: a case says which of its lines
    // was running, so the cut goes on the file as it is on disk, and Vite's own
    // transforms — TypeScript, JSX, the mock hoisting — carry it along. Under
    // `before-transforms` this plugin also probes every module, as read, and
    // the probes plugin passes them by.
    enforce: 'pre',
    // A command-line `--reporter` replaces the configured reporters rather
    // than adding to them, and an editor that runs a test from the gutter
    // passes its own. Vitest 2 has no hook that could put this seam's back.
    // The server closes when the run does, in every major, so the run is
    // folded here from what the case runner wrote, if no reporter folded it.
    // Once, because a server with two environments closes each of them.
    closeBundle() {
      return closing ??= closeRun(run, settle, [setupId, runnerId]);
    },
    // Where a file runs is the runner's to say, and `--browser` says it after
    // the configuration was written, so it is read here, where the command line
    // has already been merged in. A file in a page has no disk, no builtins and
    // no runner of this seam's: its setup module hands the runner what it ran.
    // TODO: record cases in a page — a drain per test in `beforeEach` and
    // `afterEach`, carried on each test's `meta` as the file's is. A story
    // already rides there; the record's case index does not.
    async config(config) {
      // Vite awaits this hook before the banner prints or a sequencer is
      // made, and both ask whether files are shuffled.
      const reading = readCommandLine(config.test?.sequence?.sequencer);
      if (config.test?.browser?.enabled === true) {
        inPage = true;
        // FIXME: a `snapshotSerializers` or `diff` file that imports product
        // source throws at its first probe in a page. `@vitest/browser` 3.2.7 and
        // 4.1.2 load them in `initiateRunner`, before `startTests` runs the first
        // file's setup files, and the setup module written here is what installs
        // the page's root. A module that installs it, imported ahead of them,
        // would carry what they load to the file the way the case runner does.
        // Loaded here, where a page asks for it, and not at the top: the tap
        // it sends to the page is read from the build.
        const tape = story === undefined ? undefined : (await import('../story/page.js')).storyPageSource();
        writeSeamModule(run, setupId, browserSetupSource(mode, 'vitest', tape));
        if (config.test.runner === runnerId) delete config.test.runner;
        // An index with no case in it answers *which cases walk this line* with
        // none, so a run that recorded no case writes no index.
        if (run.cases) {
          run.cases = false;
          console.warn(
            'variance-authority: a test file that runs in a page is recorded per file, not per case; ' +
              'this run writes the file-level snapshot only.',
          );
        }
      }
      await reading;
    },
    configResolved: declareConfig(run, declared, [setupId, runnerId]),
    // Vitest 3.1 and on, before any reporter starts: a command-line
    // `--reporter` leaves plugins in place, so the banner still names the seed.
    configureVitest(context) {
      seedInBanner(context.vitest);
      // A module served from Vitest's file-system cache skips every transform,
      // so a module the seam takes would run with probes whose identity this
      // process never learned, and the fold would refuse the run. Vitest 5
      // turns that cache on by default. Every module the transforms below may
      // take is kept out of it, through the same `takes` they read it with; the
      // rest stay cached.
      const define = context.defineCacheKeyGenerator ?? context.experimental_defineCacheKeyGenerator;
      define?.(({ id }) => {
        const file = cleanId(id);
        if (own(file)) return undefined;
        return takes(file) || cutting(id, file) ? false : undefined;
      });
    },
    // A file changed on disk, so its reading describes text the disk no longer
    // holds, and a rerun transforms it again only if a test still loads it.
    // So does every reading named after it: a build's regions sit on the lines
    // the file had when the build was made, and a rerun would join them to the
    // file's new ones. Nothing else goes: Vite serves an unchanged file from
    // its cache, and a reading of it is the text that runs.
    watchChange(id) {
      const changed = projectPath(root, cleanId(id));
      for (const moduleId of held.keys()) if (projectPath(root, cleanId(moduleId)) === changed) held.delete(moduleId);
      for (const [moduleId, module] of modules) {
        if (pathOf(moduleId) === changed || module.file === changed) modules.delete(moduleId);
      }
    },
    // Ahead of every transform not ordered first, wherever its plugin sits: a
    // compiler at `enforce: 'pre'` would otherwise hand the cut its output.
    transform: { order: 'pre', handler(code, id) {
      // The setup module installs the probe log; instrumented, its own header
      // would ask for the log's root before the module has installed it.
      // The runner module is this seam's too, and both sit under the root the
      // default include reaches. Compared after the query suffix is stripped,
      // because the runner is a file on disk now and a real file is the kind of
      // id a bundler decorates.
      const file = cleanId(id);
      // A `globalSetup` file is refused by the file it is as well as by the name
      // `include` is asked about, which a build's map may have changed.
      if (own(file)) return null;
      // Every module is probed after the transforms, below, and a test file
      // the run cuts is cut here, on the file as it is on disk, so its case
      // says which of its lines was running; the cut keeps every line where it
      // was and its map moves the columns back, so an inline snapshot is
      // written into the call the test wrote. In a page, `vi.mock` loads its
      // mock under the file's name, from no text of the file's that a map
      // could carry back, so a page probes first. So does a file that names
      // its own map, a build's output: Vite starts the composed map from that
      // one, so it names the build's sources and never the file.
      const cuts = cutting(id, file);
      const cutOf = (text: string) => {
        const cutFile = cuts ? cadence(text, file) : undefined;
        return cutFile === undefined ? undefined : { code: cutFile.code, map: cutFile.map };
      };
      // A query asks for a module built from the file, such as `?raw` or a
      // single-file component's block: probed after the transforms, below,
      // through the map back to the file, or marked as loaded where none
      // leads back.
      // With `before-transforms`, every module is probed here, on the text as read.
      // FIXME: in a page every module is probed here, ahead of the transforms,
      // so a compiler that reads syntax reads the probes, as it did before the
      // probes went in last. Needs `vi.mock`'s mock carried back to the file in
      // a page — see the `it.todo` in vitest-browser.test.ts.
      const late = !inPage && !before;
      if (id !== file && late) return null;
      // Under `node_modules`, `include` is asked first: no map there is read.
      const read = id === file && late && takes(file);
      const text = read ? fileOrNone(file, (at) => readFileSync(at, 'utf8')) : undefined;
      if (id === file && late) {
        if (text === undefined || !namesItsMap(text)) {
          // A case says which line of the file on disk was running, so a test
          // file a `load` hook changed has no line of the author's to cut.
          // Any other file goes on to the probes, which place it through the
          // map the hook returned, or name the hook that returned none.
          if (cuts && text !== undefined && !handedTexts(text).includes(code)) {
            throw changedOnArrival(root, file, (notes?.get(id) ?? []).map((step) => step.plugin));
          }
          if (text !== undefined) held.set(id, text);
          return cutOf(code) ?? null;
        }
        first.add(id);
      }
      // Its probes report under the file the transform was handed: a source and
      // its build both answer to the name, each with its own regions, and the
      // fold joins them (see `joinReadings`). Vitest re-transforms every run in
      // this process, so the modules stay in this map.
      const captured = capture(file, code, heldOriginal(file, text));
      if (captured === undefined) return cutOf(code) ?? null;
      // Only the file itself: any query, such as `?raw`, asks for a module built
      // from it. In a page, `vi.mock` loads its mock under the file's name.
      // Otherwise its lines are not the author's, so it fails its importers.
      if (captured.changed === true && id === file) {
        if (inPage) return null;
        throw changedOnArrival(root, file);
      }
      modules.set(captured.module.id, captured.module);
      return cutOf(captured.code) ?? { code: captured.code, map: null };
    } },
  }, {
    name: PROBES,
    // Last, on what every transform wrote: a compiler that reads syntax — a
    // CSS-in-JS extractor, a memoising compiler — reads no probe. The regions
    // are cut from the file on disk as they are when the probes go in first,
    // and placed where the map Vite composed says their code went. Vite
    // composes a plugin that rewrote the file and returned no map as moving
    // nothing, so every other plugin is watched for one.
    enforce: 'post',
    configResolved(config) {
      // Ahead of every transform, no map is read, so no step is watched for one.
      if (before) return;
      const { plugins } = config as unknown as { plugins: readonly { name: string; transform?: unknown }[] };
      notes = watchUnmapped(plugins, PROBES);
      refuseTransformsAfter(plugins, PROBES);
    },
    transform: { order: 'post', handler(code, id) {
      const file = cleanId(id);
      const text = held.get(id);
      held.delete(id);
      // FIXME: `inPage` skips the probes here; see the FIXME on `late` above.
      if (own(file) || inPage || before || first.delete(id)) return null;
      const original = heldOriginal(file, text);
      const captured = after(file, code, () => this.getCombinedSourcemap(), unmappedSteps(this, id, notes), id !== file, original);
      if (captured === undefined) return null;
      modules.set(captured.module.id, captured.module);
      return {
        code: captured.code,
        map: captured.mappings === undefined ? null : { version: 3, sources: [file], names: [], mappings: captured.mappings },
      };
    } },
  }];
}

const PROBES = 'variance-authority:test-selection-probes';

/** The refusal of a file whose lines no longer match the file on disk when it reaches the seam, naming the `load` hooks that rewrote it with no map. */
function changedOnArrival(root: string, file: string, loaders: readonly string[] = []): Error {
  const by = loaders.length === 0
    ? 'a `load` hook or a plugin placed ahead of it rewrote the file'
    : `the \`load\` hook of ${loaders.map((name) => `\`${name}\``).join(', ')} rewrote the file`;
  return new Error(
    `\`${projectPath(root, file)}\` reached \`withTestSelection\` already changed: ${by}, ` +
      'and its lines no longer match the file on disk. Let the file load as it is on disk, or leave it out of `include`.',
  );
}

/**
 * Fold a run no reporter folded, from the trees its workers wrote, and take
 * the shims off, with the directory the run made for them once they leave it
 * empty: a watching run kept them for its reruns, and this is its last.
 *
 * A run whose runner is the project's own left journals and no tree, and a
 * journal alone cannot say whether its file passed: it is said, and nothing is
 * written, rather than a record that calls every file complete.
 */
async function closeRun(
  run: SelectionRun,
  settle: (files: readonly FinishedFile[]) => Promise<void>,
  shims: readonly string[],
): Promise<void> {
  try {
    await foldUnfolded(run, settle);
  } finally {
    removeSeamModules(run, shims);
  }
}

async function foldUnfolded(
  run: SelectionRun,
  settle: (files: readonly FinishedFile[]) => Promise<void>,
): Promise<void> {
  if (run.settled) return;
  const files = await readFinished(run.finishedDirectory);
  if (files.length > 0) return settle(files);
  if (!existsSync(run.runDirectory)) return;
  run.settled = true;
  console.warn(
    'variance-authority: this run recorded nothing. A command-line `--reporter` replaced the ' +
      'reporter that writes the record, and the configured `runner` is the project\'s own, so no ' +
      'worker reported which files passed. The record is as it was before this run.',
  );
  rmSync(run.runDirectory, { recursive: true, force: true });
  rmSync(run.caseDirectory, { recursive: true, force: true });
}

