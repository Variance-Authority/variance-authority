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
import { shardArgument } from '@variance-authority/sense/test-selection';
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

/** The subset of a Playwright configuration this reads and rewrites. */
export interface PlaywrightSelectionConfig {
  readonly use?: object;
  readonly reporter?: string | ReadonlyArray<string | readonly [string, unknown?]>;
  readonly projects?: ReadonlyArray<{ readonly name?: string; readonly use?: object }>;
  readonly shard?: PlaywrightShard | null;
  readonly build?: { readonly external?: readonly string[] };
  readonly '@playwright/test'?: { readonly babelPlugins?: readonly unknown[] };
}

/**
 * Turn recording on for every project in a Playwright configuration, and add
 * the reporter that folds what the workers staged.
 *
 * Everything the configuration already had stays, its own reporters included
 * and in their order; a configuration with none keeps Playwright's default by
 * naming it, because a `reporter` array of one entry replaces the default
 * rather than adding to it. Its own `babelPlugins` stay too, and the plugin
 * that cuts each spec statement by statement goes after them, unless
 * `cadence` is `false`.
 *
 * The suite still has to be built with `testSelectionProbes()` from
 * `@variance-authority/sense/journal` — this wires the runner, not the page —
 * and a run whose application has no collector says so on stderr and records
 * nothing.
 *
 * A run that asks for a shard, by `--shard` or the configuration's `shard`, is
 * refused here, before anything starts, when the project's Playwright is older
 * than 1.62 and would split it test by test, or when a `--reporter` on the
 * command line replaces the reporter that places it by whole files.
 */
export function withTestSelection<Config extends object = PlaywrightSelectionConfig>(
  config: Config & PlaywrightSelectionConfig = {} as Config & PlaywrightSelectionConfig,
  recording: ExecutionRecording = {},
): Config {
  refuseShard(config.shard as PlaywrightShard | null | undefined);
  const reporters =
    config.reporter === undefined
      ? ['list' as const]
      : typeof config.reporter === 'string'
        ? [config.reporter]
        : [...config.reporter];
  const compile = config['@playwright/test'] as { readonly babelPlugins?: readonly unknown[] } | undefined;
  const build = config['build'] as { readonly external?: readonly string[] } | undefined;
  return {
    ...config,
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
          })),
        }),
    reporter: [...reporters, [SELECTION_REPORTER, { ...recording }] as const],
  };
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
