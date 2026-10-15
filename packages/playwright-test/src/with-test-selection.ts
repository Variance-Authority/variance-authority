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

import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExecutionRecording } from './execution.js';
import { installedPlaywright, reporterArgument, shardArgument, shardRefusal, type PlaywrightShard } from './whole-file-shard.js';

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
  readonly use?: Record<string, unknown>;
  readonly reporter?: string | ReadonlyArray<string | readonly [string, unknown?]>;
  readonly projects?: ReadonlyArray<{ readonly use?: Record<string, unknown>; readonly [key: string]: unknown }>;
  readonly [key: string]: unknown;
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
export function withTestSelection<Config extends PlaywrightSelectionConfig>(
  config: Config = {} as Config,
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
 * Playwright with no `preprocess`, which the project at the cwd resolves, or a
 * `--reporter` that leaves the selection reporter out.
 */
function refuseShard(configured: PlaywrightShard | null | undefined): void {
  const argv = process.argv;
  const shard = shardArgument(argv) ?? configured ?? undefined;
  if (shard === undefined) return;
  const old = shardRefusal(installedPlaywright(process.cwd()), shard);
  if (old !== undefined) throw new Error(old);
  const reporters = reporterArgument(argv);
  if (reporters === undefined || reporters.includes(SELECTION_REPORTER)) return;
  throw new Error(
    `variance-authority: refusing shard ${shard.current}/${shard.total}: --reporter ${reporters.join(',')} replaces the configuration's reporters, ` +
      `so ${SELECTION_REPORTER}, which places the shard by whole files, would not run; name it in --reporter too`,
  );
}
