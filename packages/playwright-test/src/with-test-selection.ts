/**
 * One place to say what this run records, instead of two that have to agree.
 *
 * The recording fixtures and the reporter read the same values — the root,
 * the cache, the coverage index, the probe recipe — and a configuration that spells them twice is a
 * configuration where they can differ. A mismatch is not an error anybody
 * sees: the workers stage crossings recorded against one root and the fold
 * resolves them against another, and the result is a record written under
 * paths no later run will ask about.
 *
 * ```ts
 * // playwright.config.ts
 * import { withTestSelection } from '@variance-authority/playwright-test';
 *
 * export default defineConfig(withTestSelection({
 *   projects: [{ name: 'chromium', use: devices['Desktop Chrome'] }],
 * }, { preconditions: ['playwright/fixtures.ts'] }));
 * ```
 *
 * Every project is given the recording, because a project is a second run of
 * the same specs and a project the wrapper skipped would drive the page
 * without draining it. The reporter is the run's rather than a project's —
 * Playwright folds once — so it is added once, at the top.
 */

import { existsSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExecutionRecording } from './execution.js';
import {
  askedSelection,
  recordFileFor,
  repositoryRoot,
  shardArgument,
  type SuiteSelection,
} from '@variance-authority/sense/test-selection';
import { SELECTION_SETUP, SkippedFiles, selectFiles } from './file-selection.js';
import { installedPlaywright, reporterArgument, shardRefusal, type PlaywrightShard } from './whole-file-shard.js';

/** The reporter entry, by the specifier a configuration names it with. */
export const SELECTION_REPORTER = '@variance-authority/playwright-test/reporter';

/** The Babel plugin that cuts each spec, by the path Playwright `require`s it from. */
const CADENCE_PLUGIN = fileURLToPath(new URL('./cadence-babel.cjs', import.meta.url));

/**
 * The compiled sense package the plugin requires, as a glob Playwright's
 * transpiler leaves alone. Playwright compiles every file outside
 * `node_modules` it `require`s as CommonJS, and sense is ES modules: linked
 * into a workspace, its real path is outside `node_modules`, and the plugin
 * would not load.
 */
const SENSE_DIST = `**/${dirname(dirname(realpathSync(createRequire(import.meta.url).resolve('@variance-authority/sense/instrument'))))
  .split(sep)
  .join('/')
  .replace(/^\//u, '')}/**`;

/** A `testIgnore` or `testMatch`, as Playwright takes one. */
type FilePatterns = string | RegExp | ReadonlyArray<string | RegExp>;

/** The subset of a Playwright configuration this reads and rewrites. */
export interface PlaywrightSelectionConfig {
  readonly use?: object;
  readonly reporter?: string | ReadonlyArray<string | readonly [string, unknown?]>;
  readonly projects?: ReadonlyArray<{ readonly name?: string; readonly use?: object; readonly testIgnore?: FilePatterns }>;
  readonly testIgnore?: FilePatterns;
  readonly globalSetup?: string | readonly string[];
  readonly shard?: PlaywrightShard | null;
  readonly build?: { readonly external?: readonly string[] };
  readonly '@playwright/test'?: { readonly babelPlugins?: readonly unknown[] };
}

/** What `withTestSelection` is told: where the record goes, and what the run selects by. */
export interface TestSelection extends ExecutionRecording {
  /**
   * The selection this run is handed, read once before Playwright collects a
   * file. Each project's `testIgnore` drops what it skips, after the
   * project's own patterns, and stderr says `selected N of M`. Absent,
   * `VARIANCE_AUTHORITY_SINCE` asks for the one `variance select` reads, and
   * with that unset every file runs.
   */
  readonly selection?: () => Promise<SuiteSelection>;
}

/**
 * Turn recording on for every project in a Playwright configuration, add the
 * reporter that folds what the workers staged, and, given a since commit, run
 * only the files the selection keeps (`selectingFiles`). Everything the
 * configuration had stays: its reporters in their order, Playwright's default
 * named when it had none, and its `babelPlugins` ahead of the cadence cut.
 *
 * The application still needs `testSelectionProbes()` from
 * `@variance-authority/sense/journal`. A shard nothing would place by whole
 * files is refused here, before anything starts (`refuseShard`).
 */
export function withTestSelection<Config extends object = PlaywrightSelectionConfig>(
  config: Config & PlaywrightSelectionConfig = {} as Config & PlaywrightSelectionConfig,
  options: TestSelection = {},
): Config {
  const { selection, ...recording } = options;
  refuseShard(config.shard as PlaywrightShard | null | undefined);
  const reporters =
    config.reporter === undefined
      ? ['list' as const]
      : typeof config.reporter === 'string'
        ? [config.reporter]
        : [...config.reporter];
  const compile = config['@playwright/test'] as { readonly babelPlugins?: readonly unknown[] } | undefined;
  const build = config['build'] as { readonly external?: readonly string[] } | undefined;
  const drop = selectingFiles(config, recording, selection);
  return {
    ...config,
    ...(drop === undefined
      ? {}
      : { globalSetup: [SELECTION_SETUP, ...listed(config.globalSetup)], testIgnore: [...listed(config.testIgnore), drop] }),
    ...(recording.cadence === false
      ? {}
      : {
          '@playwright/test': { ...compile, babelPlugins: [...(compile?.babelPlugins ?? []), [CADENCE_PLUGIN]] },
          build: { ...build, external: [...(build?.external ?? []), SENSE_DIST] },
        }),
    use: { ...config.use, varianceExecution: recording },
    ...(config.projects === undefined
      ? {}
      : {
          projects: config.projects.map((project) => ({
            ...project,
            use: { ...project.use, varianceExecution: recording },
            // A project's own `testIgnore` replaces the top level's rather than adding to it.
            ...(drop === undefined || project.testIgnore === undefined ? {} : { testIgnore: [...listed(project.testIgnore), drop] }),
          })),
        }),
    reporter: [...reporters, [SELECTION_REPORTER, { ...recording }] as const],
  };
}

/** What decides whether a configuration selects, read from the process unless a test says otherwise. */
export interface SelectingProcess {
  readonly argv?: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
  readonly say?: (line: string) => void;
}

/**
 * The `testIgnore` pattern that drops what the selection skips, with the
 * selection asked for in this process, or nothing when the run does not
 * select: no since commit and no selection handed in, a process that is not
 * the main one of a `playwright test`, watch and UI mode, `--list`, and a
 * configuration already wrapped, which selects once.
 */
export function selectingFiles(
  config: PlaywrightSelectionConfig,
  recording: ExecutionRecording,
  handed: (() => Promise<SuiteSelection>) | undefined,
  { argv = process.argv, env = process.env, say = (line) => process.stderr.write(`${line}\n`) }: SelectingProcess = {},
): SkippedFiles | undefined {
  if (listed(config.testIgnore).some((pattern) => pattern instanceof SkippedFiles)) return undefined;
  // A worker evaluates the configuration again; the main process has already
  // dropped the files, and the reporter, `show-report` and `merge-reports`
  // collect none. `argv[2]` is the command the `playwright` binary was given,
  // the only process shape that collects files.
  if (env['TEST_WORKER_INDEX'] !== undefined || argv[2] !== 'test') return undefined;
  const start = resolve(recording.root ?? process.cwd());
  const root = repositoryRoot(start);
  const suite = recording.suite === undefined ? {} : { suite: recording.suite };
  // Noted against the record the reporter folds into, which names it as the record this run started from.
  const asked = askedSelection(handed, () => recordFileFor(root, start, recording), { root, from: start, ...suite }, env, say);
  if (asked === undefined) return undefined;
  const flag = (name: string) => argv.some((argument) => argument === name || argument.startsWith(`${name}=`));
  if (env['PWTEST_WATCH'] !== undefined || flag('--ui') || flag('--ui-port') || flag('--ui-host')) {
    say('variance-authority: watch mode does not select');
    return undefined;
  }
  if (flag('--list')) {
    say('variance-authority: --list runs no global setup, where the selection is read, so nothing is selected');
    return undefined;
  }
  selectFiles(root, asked);
  return new SkippedFiles();
}

/** A configuration value that is one or a list of them, as a list. */
function listed<Value>(value: Value | readonly Value[] | undefined): readonly Value[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value as Value];
}

/**
 * Throw when this run asks for a shard nothing would place by whole files: a
 * Playwright with no `preprocess`, which the configuration's directory
 * resolves, or a `--reporter` that leaves the selection reporter out.
 */
function refuseShard(configured: PlaywrightShard | null | undefined): void {
  const argv = process.argv;
  const asked = shardArgument(argv);
  const shard = asked === undefined ? configured ?? undefined : { current: asked.index, total: asked.count };
  if (shard === undefined) return;
  const old = shardRefusal(installedPlaywright(configDirectory(argv)), shard);
  if (old !== undefined) throw new Error(old);
  const reporters = reporterArgument(argv);
  if (reporters === undefined || reporters.some(isSelectionReporter)) return;
  throw new Error(
    `variance-authority: refusing shard ${shard.current}/${shard.total}: --reporter ${reporters.join(',')} replaces the configuration's reporters, ` +
      `so ${SELECTION_REPORTER}, which places the shard by whole files, would not run; name it in --reporter too`,
  );
}

/**
 * The directory of the configuration Playwright loads: `-c`/`--config`
 * resolved from the cwd, a file's directory or the directory named, and the
 * cwd when neither is given — where Playwright looks for one.
 */
function configDirectory(argv: readonly string[]): string {
  let named: string | undefined;
  for (const [at, argument] of argv.entries()) {
    if (argument === '-c' || argument === '--config') named = argv[at + 1];
    else if (argument.startsWith('--config=')) named = argument.slice('--config='.length);
  }
  if (named === undefined) return process.cwd();
  const at = resolve(process.cwd(), named);
  return existsSync(at) && statSync(at).isDirectory() ? at : dirname(at);
}

/**
 * Whether a `--reporter` name is the selection reporter, resolved as
 * Playwright resolves a command line's reporter: a path that exists from the
 * cwd, else a module from the cwd.
 */
function isSelectionReporter(name: string): boolean {
  if (name === SELECTION_REPORTER) return true;
  const own = realpathSync(createRequire(import.meta.url).resolve(SELECTION_REPORTER));
  const local = resolve(process.cwd(), name);
  try {
    const at = existsSync(local) ? local : createRequire(resolve(process.cwd(), 'package.json')).resolve(name);
    return realpathSync(at) === own;
  } catch {
    return false;
  }
}
