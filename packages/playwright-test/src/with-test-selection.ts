/**
 * One place to say what this run records, instead of two that have to agree.
 *
 * The recording fixtures and the reporter read the same five values — the
 * root, the label and cache the build wrote its records under, the coverage
 * index, the probe recipe — and a configuration that spells them twice is a
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
 * }, { label: 'app', preconditions: ['playwright/fixtures.ts'] }));
 * ```
 *
 * Every project is given the recording, because a project is a second run of
 * the same specs and a project the wrapper skipped would drive the page
 * without draining it. The reporter is the run's rather than a project's —
 * Playwright folds once — so it is added once, at the top.
 */

import type { ExecutionRecording } from './execution.js';

/** The reporter entry, by the specifier a configuration names it with. */
export const SELECTION_REPORTER = '@variance-authority/playwright-test/reporter';

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
 * rather than adding to it.
 *
 * The suite still has to be built with `testSelectionProbes()` from
 * `@variance-authority/sense/journal` — this wires the runner, not the page —
 * and a run whose application has no collector says so on stderr and records
 * nothing.
 */
export function withTestSelection<Config extends PlaywrightSelectionConfig>(
  config: Config = {} as Config,
  recording: ExecutionRecording = {},
): Config {
  const reporters =
    config.reporter === undefined
      ? ['list' as const]
      : typeof config.reporter === 'string'
        ? [config.reporter]
        : [...config.reporter];
  return {
    ...config,
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
