import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, relative, resolve, sep } from 'node:path';
// FIXME: Vitest's colour in `sense`; the integration belongs to a vitest-coloured
// package that fills the selection's extension point.
import type { ViteUserConfig as UserConfig } from 'vitest/config';
import { probesRegions } from '../instrument/identity.js';
import type { InstrumentMode } from '../instrument/index.js';
import { captureAfter, placeModule, type Captured, type CapturedAfter, type ComposedMap } from './captured-modules.js';
import type { UnmappedStep } from './unmapped-transforms.js';
import { defaultInclude, type ProbePlacement } from './instrumented-modules.js';
import { writeCut } from './case-cut.js';
import { caseRunnerSource, setupSource } from './worker-source.js';
import { foldRun } from './selection-fold.js';
import { declareConfig } from './governing-config.js';
import { selectionPlugin, type ConfigPlugin } from './vitest-plugin.js';
import { runFor, seamModuleId, writeSeamModule, type SelectionRun } from './selection-run.js';
import { recordFileFor, recordsAlone } from './record-location.js';
import { testFilesAt } from './test-files.js';
import { selectionReporter } from './vitest-reporter.js';
import { repositoryRoot } from './repository-root.js';
import { askedForStories } from '../story/directory.js';
import type { SuiteSelection } from './suite-selection.js';
import { askedSelection, landingTimes } from './selection-environment.js';
import { seedInBanner, selectingSequencer, type SequencerClass } from './vitest-sequencer.js';
import { shardArgument } from './shard-placement.js';

export interface TestSelectionOptions {
  /**
   * A directory inside the repository; defaults to the Vitest config root, then
   * the current directory. Names are relative to the checkout it sits in, never
   * to it, and relative option paths resolve against it.
   */
  readonly root?: string;
  /** Persisted coverage index. Defaults to the repository's cache. */
  readonly coverageFile?: string;
  /**
   * The suite this run is, as the root `variance.config.json` declares it under
   * `suites`. Required once any suite is declared, and refused beside
   * `coverageFile`.
   */
  readonly suite?: string;
  /** Decide which transformed modules are product source. */
  readonly include?: (file: string) => boolean;
  /**
   * Decide which transformed modules are product source no probe may sit in:
   * a module whose functions cross into a page as text, where the first probe
   * would throw. It wins over `include`. Each is marked as loaded at its end
   * instead, and an edit to it selects every test that loaded it.
   */
  readonly unprobed?: (file: string) => boolean;
  /**
   * Files whose contents are preconditions of every test observation, beside
   * the ones the seam declares on its own: the config file Vite loaded, the
   * local modules it bundled into it, and the configured setup files. Name a
   * file the runner reads without Vite knowing — compiler settings, a fixture
   * read with `fs`.
   */
  readonly preconditions?: readonly string[];
  /**
   * `presence`, the default, probes every arrival region; `entries` probes
   * modules and functions only, so a suite reads it no finer than
   * `function-use`. Both record which functions ran before the file's first
   * test. `loads` probes nothing: each module
   * runs with one line after its own text, the record says which files each
   * test loaded, and a change to a file selects every test that loaded it.
   * Under it `cadence` is off, whatever it says.
   */
  readonly mode?: InstrumentMode;
  /**
   * Where the probes go. `after-transforms`, the default, places them in what
   * the project's transforms wrote, through the map Vite composes, so a
   * compiler that reads syntax reads none. `before-transforms` places them in
   * the file as read, one parse and no map: for a suite whose transforms only
   * strip types or JSX.
   */
  readonly placement?: ProbePlacement;
  /**
   * Follow each case through the async context, and name the cases whose work
   * outlived them.
   *
   * Without it, the case recording assumes what a suite almost always is: one
   * case at a time. The case running now is a variable, the probe reads a closure slot
   * for it, and per-case recording costs what the per-file recording costs. A
   * second case opening while one is still open records that file whole rather
   * than guessing, because the guess charges one case's crossings to another and a
   * case credited with less than it reached is a case a change can skip.
   *
   * With it, each case gets an async context instead, which follows its
   * continuations wherever they settle and gives concurrent cases a bucket
   * each. Reading which continuation is running costs 4.7 nanoseconds a
   * crossing over the variable, which a microbenchmark separates and a real
   * suite does not: over zod's 5,656 cases the crossing count predicts 0.2%,
   * and the runs do not resolve it. What you buy for it is the list of cases
   * that made a crossing after they had settled, printed when the file ends:
   * the tests that are still running when the next one starts.
   *
   * Turn it on to find those, and to record a suite that is deliberately
   * concurrent. Leave it off the rest of the time.
   */
  readonly continuations?: boolean;
  /**
   * Whether each statement of a test or a hook is cut, so the record says which
   * line of the test first reached each region its case entered. On by default.
   * The cut is one call per statement the test runs, and it reaches the record
   * only as a line per case; turn it off to record a suite exactly as it ran
   * before cuts existed.
   */
  readonly cadence?: boolean;
  /**
   * The selection this run is handed, read once when Vitest first sorts its
   * files. A wrapping `sequence.sequencer` drops what it may skip and hands
   * the rest to the project's own, and stderr says `selected N of M`. Absent,
   * `VARIANCE_AUTHORITY_SINCE` asks for the one `variance select` reads, and
   * with that unset every file runs.
   */
  readonly selection?: () => Promise<SuiteSelection>;
}

/**
 * Add source instrumentation, test-file attribution, and coverage persistence to
 * an ordinary Vitest configuration.
 *
 * Applies to a single configuration, and to both halves of a `projects` layout:
 * wrap the root config and each project config that should be recorded, and the
 * run they describe is one run.
 */
export function withTestSelection(
  config: UserConfig = {},
  options: TestSelectionOptions = {},
): UserConfig {
  const configRoot = resolve(options.root ?? config.root ?? process.cwd());
  const root = repositoryRoot(configRoot);
  const coverageFile = recordFileFor(root, configRoot, options);
  const mode = options.mode ?? 'presence';
  const run = runFor(coverageFile, root, mode);
  const setupId = seamModuleId(configRoot, run, 'setup');
  const runnerId = seamModuleId(configRoot, run, 'case-runner');
  // A `globalSetup` file runs once, in the Vitest process, before any test
  // environment exists — the setup shim that installs `globalThis.__VA__` is a
  // `setupFiles` entry and has never run there. Instrumented, such a file
  // throws at its first probe and takes the whole suite with it before a single
  // test loads. The resolved config names these files, so they are excluded by
  // path rather than guessed at from their names; `defaultInclude` carries the
  // filename-shaped backstop for config files themselves.
  const globalSetup = new Set(
    array((config.test as { globalSetup?: string | readonly string[] } | undefined)?.globalSetup)
      .filter((file): file is string => typeof file === 'string')
      .map((file) => resolve(configRoot, file)),
  );
  const chosen = options.include ?? defaultInclude;
  const include = (file: string): boolean => !globalSetup.has(file) && chosen(file);
  const marked = options.unprobed;
  const unprobed = marked === undefined ? undefined : (file: string): boolean => !globalSetup.has(file) && marked(file);
  // A module `unprobed` names runs as it is, marked as loaded at its end, whatever `include` says.
  const capture = (file: string, code: string, original: (at: string) => string): Captured | undefined =>
    placeModule(root, file, code, include, unprobed, mode, original);
  // A module's probes go in after every transform, through the map Vite
  // composed back to the file, so a compiler that reads syntax reads none.
  const after = (
    file: string,
    code: string,
    map: () => ComposedMap,
    unmapped: readonly UnmappedStep[],
    variant: boolean,
    original: (at: string) => string,
  ): CapturedAfter | undefined => captureAfter(root, file, code, include, mode, map, { unprobed, unmapped, variant, original });
  const setupFiles = array(config.test?.setupFiles);
  // What the author declared is declared for the tests this configuration
  // governs, which for the one that describes the run is every test.
  const declared = (options.preconditions ?? []).map((file) => resolve(configRoot, file));

  const suite = options.suite === undefined ? {} : { suite: options.suite };
  const selection = askedSelection(options.selection, () => coverageFile, { root, from: configRoot, ...suite });
  const settle = foldRun(run, { coverageFile, shims: [setupId, runnerId] });
  // Asked of the mode, not of `run.cases`: a page clears that on the run, and
  // Vitest loads the configuration again for its browser server, in this process.
  const story = probesRegions(mode) ? askedForStories(coverageFile) : undefined;
  const reporter = selectionReporter(run, settle, story);
  // Ahead of the project's reporters, so the banner the first of them prints
  // names the seed of a shuffled run, as Vitest's own does.
  const reporters = [{ onInit: seedInBanner }, ...(config.test?.reporters === undefined ? ['default'] : array(config.test.reporters))];

  // A configuration that names projects describes the run rather than a suite:
  // nothing is transformed under it, and it is the only place a reporter is
  // read from. The instrumenting plugin and the setup file would sit on a
  // config that loads no test file; what it carries is its own file, which
  // governs every project it lists.
  // `projects` is Vitest 3 and 4's name for it; Vitest 2 called the same idea
  // `workspace`. Read structurally, because the seam is built against one of
  // them and run against whichever the project installed.
  const describesProjects = (config.test as { projects?: unknown } | undefined)?.projects !== undefined;
  if (describesProjects) {
    return {
      ...config,
      plugins: [...array(config.plugins), {
        name: 'variance-authority:test-selection-config',
        configResolved: declareConfig(run, declared, [setupId, runnerId]),
      } satisfies ConfigPlugin],
      test: { ...config.test, ...selecting(config, root, configRoot, options, coverageFile, selection, run), reporters: [...reporters, reporter] },
    };
  }

  // Under `loads` no region is probed, so no line of a test can be said to
  // have reached one first: the cut would cost a call per statement for nothing.
  const cut = options.cadence === false || (!run.cases && story === undefined) ? undefined : testFiles(config, configRoot);
  const plugins = selectionPlugin(root, setupId, runnerId, globalSetup, run, { include, unprobed }, { capture, after }, mode, declared, settle, cut, options.placement ?? 'after-transforms', story);
  // The realm's engine is decided once, by whichever of the two shims installs
  // it first, so both are handed the same answers.
  const continuations = run.cases && options.continuations === true;
  return {
    ...config,
    plugins: [...array(config.plugins), ...plugins],
    test: {
      ...config.test,
      ...selecting(config, root, configRoot, options, coverageFile, selection, run),
      // First, so what a setup file of the project's loads is logged into the
      // file's own bucket: before the shim opens it, a probe in a realm that
      // already ran a file writes into the idle one, and under a runner of the
      // project's own finds no root at all.
      // On disk rather than virtual — see {@link writeSeamModule}.
      setupFiles: [
        writeSeamModule(
          run,
          setupId,
          setupSource(run.runDirectory, run.caseDirectory, { continuations, story, root, cases: run.cases }),
        ),
        ...setupFiles,
      ],
      // Kept for a single-configuration project, where this config is the root
      // one as well and its reporters are the ones that run.
      reporters: [...reporters, reporter],
      // A runner of the project's own is left alone rather than replaced: a case
      // scope is worth less than a suite that runs. Per-case recording then has
      // no bracket and records the file as one ambient bucket, which is the
      // file-level answer it already had.
      // FIXME: a project with its own runner gets file-level answers without
      // being told, and a `snapshotSerializers` or `diff` file of its that
      // imports product source throws at its first probe, because this seam's
      // runner is what installs the probe root before Vitest loads them; the
      // case runner could extend the configured class instead.
      ...(config.test?.runner === undefined
        ? {
          runner: writeSeamModule(run, runnerId, caseRunnerSource({
            ...runnerImports(configRoot, runnerId),
            finished: run.finishedDirectory,
            cut: run.cutFile,
            recording: { continuations, story: story !== undefined },
          })),
        }
        : {}),
    },
  };
}

/**
 * The sequencer that drops what the selection skips and places a `--shard` by
 * recorded time. Under `--shard` the run passes with no tests unless the
 * configuration says otherwise: Vitest 4 refuses a run with fewer files than
 * shards before any sequencer places one, and a shard left no file is a
 * placement, as it is under Jest.
 */
function selecting(
  config: UserConfig,
  root: string,
  configRoot: string,
  options: TestSelectionOptions,
  coverageFile: string,
  selection: (() => Promise<SuiteSelection>) | undefined,
  run: SelectionRun,
): Pick<NonNullable<UserConfig['test']>, 'sequence' | 'passWithNoTests'> {
  const suite = options.suite === undefined ? {} : { suite: options.suite };
  const sequence = config.test?.sequence;
  const own = sequence?.sequencer as unknown as SequencerClass | undefined;
  const times = landingTimes(coverageFile, { root, from: configRoot, ...suite, byFile: options.coverageFile !== undefined });
  const sequencer = selectingSequencer(own, {
    root, configRoot, ...(selection === undefined ? {} : { selection }), times, shuffle: sequence?.shuffle,
    sharded: (asked) => { run.alone = recordsAlone(asked, selection !== undefined); },
    cut: (cases) => {
      for (const [file, names] of cases) run.cut.set(file, names);
      writeCut(run.cutFile, run.cut);
    },
  });
  type Sequence = NonNullable<NonNullable<UserConfig['test']>['sequence']>;
  const empty = shardArgument(process.argv) !== undefined && config.test?.passWithNoTests === undefined ? { passWithNoTests: true } : {};
  return { sequence: { ...sequence, sequencer: sequencer as unknown as NonNullable<Sequence['sequencer']> }, ...empty };
}

/**
 * How the case runner should spell `@vitest/runner`, on a Vitest that ships it.
 *
 * The runner is a file in the project root, and `@vitest/runner` is Vitest's
 * dependency rather than the project's. A layout that hoists answers a bare
 * specifier there and pnpm's does not: the import resolves to nothing, every
 * test file fails to load, and the run reports the files that needed no runner
 * as a pass. Measured on TanStack Query, where 25 of 188 files ran and the
 * suite went green in a third of the time.
 *
 * So the specifier is resolved from Vitest — which every project that runs one
 * can resolve — and the runner is handed a path to that file. Asking the root
 * first is not the cheaper check it looks like: inside the process that loads a
 * Vitest config the bare specifier resolves under pnpm as well, and the file
 * the runner is written to still cannot resolve it.
 *
 * Relative rather than absolute, because a leading slash is root-relative to
 * Vite. To the file Vitest itself loads, because a second copy of
 * `@vitest/runner` is a second `getFn` over a different map, and that one
 * answers `undefined` for every task.
 *
 * Nothing where Vitest's manifest declares no `@vitest/runner`: Vitest 5
 * ships none, and the runner reads its class instead. A Vitest the root
 * cannot resolve leaves the bare specifiers, as before.
 */
function runnerImports(root: string, runnerId: string): { module?: string; utils?: string } {
  let entry: string;
  try {
    entry = createRequire(resolve(root, 'package.json')).resolve('vitest');
  } catch {
    return { module: '@vitest/runner', utils: '@vitest/runner/utils' };
  }
  if (!dependsOnRunner(entry)) return {};
  const fromVitest = createRequire(entry);
  const spelling = (specifier: string): string => {
    const path = relative(dirname(runnerId), fromVitest.resolve(specifier)).split(sep).join('/');
    return path.startsWith('.') ? path : `./${path}`;
  };
  return { module: spelling('@vitest/runner'), utils: spelling('@vitest/runner/utils') };
}

/**
 * Whether the Vitest whose entry this is declares `@vitest/runner` among its
 * dependencies. Its manifest answers, not resolution: inside a monorepo whose
 * root runs an older Vitest, the specifier resolves from Vitest 5 by walking up
 * to the root's copy, which is another Vitest's runner.
 */
function dependsOnRunner(entry: string): boolean {
  for (let directory = dirname(entry); ; directory = dirname(directory)) {
    let manifest: { name?: string; dependencies?: Record<string, string> };
    try {
      manifest = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
    } catch {
      manifest = {};
    }
    if (manifest.name === 'vitest') return manifest.dependencies?.['@vitest/runner'] !== undefined;
    if (dirname(directory) === directory) return true;
  }
}

function array<T>(value: T | readonly T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? [...value] : [value as T];
}

/**
 * Which files this configuration runs as tests: its `test.include` globs, under
 * `test.dir` or the root, as Vitest's own search reads them.
 */
function testFiles(config: UserConfig, configRoot: string): (file: string) => boolean {
  const test = config.test as { include?: readonly string[]; dir?: string } | undefined;
  return testFilesAt(configRoot, test?.dir, test?.include);
}
