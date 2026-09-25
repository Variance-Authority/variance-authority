/**
 * Which configuration a test ran under, and what that configuration rests on.
 *
 * A Vitest run with `projects` is one process over several configurations, and
 * a project's config, the local modules it imports and its setup files govern
 * that project's tests and no others. A workspace with a unit project and a
 * browser project is the common shape: an edit to the browser project's setup
 * file does not change what a unit test ran, and charging it there reruns a
 * suite nothing reached. The configuration that describes the run governs all
 * of them, because it decides which projects exist.
 *
 * So each configuration's files are kept under the file Vite loaded, and the
 * runner is asked which configuration ran each test file: Vitest resolved the
 * project, and a name or a directory guessed here would be a second answer to
 * its question. When the runner does not say, a test rests on every
 * configuration the run declared, which is what it rested on before anybody
 * asked.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SelectionRun } from './selection-run.js';

/** What Vite resolved, as far as the seam reads it. */
export interface ResolvedViteConfig {
  readonly configFile: string | undefined;
  readonly configFileDependencies: readonly string[];
  readonly root?: string;
  readonly test?: { readonly setupFiles?: unknown };
}

/** A configuration handed to Vitest inline has no file, and is keyed by none. */
export function configKey(configFile: string | undefined): string {
  return configFile === undefined ? '' : resolve(configFile);
}

/**
 * Declare the configuration Vite loaded, and what it loads before every test,
 * as preconditions of the tests that run under it.
 *
 * Asked of Vite, which read the file, rather than of the command line or a
 * list of likely names: `configFile` is the file it loaded, and
 * `configFileDependencies` the local modules it bundled into that file — the
 * set Vite restarts the server over. A package the config imports stays
 * outside it, as it does when Vite bundles, and is read as the install.
 *
 * Setup files are read here too, from the resolved config and against its
 * resolved root, which is where Vitest resolves them: a project's config
 * handed to the seam from the repository root names its setup file relative to
 * its own directory, and read against the wrong one it was a missing file,
 * declared nowhere. A setup entry may be a package — `dotenv/config` — rather
 * than a file of the project's, and a package is no precondition a diff can
 * carry.
 */
export function declareConfig(
  run: SelectionRun,
  declared: readonly string[],
  shims: readonly string[],
): (config: ResolvedViteConfig) => void {
  return ({ configFile, configFileDependencies, root, test }) => {
    const key = configKey(configFile);
    const own = run.configs.get(key) ?? new Set<string>();
    run.configs.set(key, own);
    for (const file of [...(configFile === undefined ? [] : [configFile]), ...configFileDependencies, ...declared]) {
      own.add(resolve(file));
    }
    const setupFiles = test?.setupFiles;
    for (const file of Array.isArray(setupFiles) ? setupFiles : [setupFiles]) {
      if (typeof file !== 'string') continue;
      const path = resolve(root ?? process.cwd(), file);
      if (!shims.includes(path) && existsSync(path)) own.add(path);
    }
  };
}

/** A Vitest 2 workspace project, or a Vitest 3 and 4 test project, structurally. */
export interface RunnerProject {
  readonly name?: string;
  readonly getName?: () => string;
  readonly vite?: { readonly config?: { readonly configFile?: string } };
  readonly server?: { readonly config?: { readonly configFile?: string } };
}

/** The runner itself, as far as a reporter's `onInit` reads it. */
export interface RunnerContext extends RunnerProject {
  readonly projects?: readonly RunnerProject[];
}

/** The config file Vite loaded for a project, as a key. */
export function projectConfig(project: RunnerProject | undefined): string | undefined {
  const server = project?.vite ?? project?.server;
  return server?.config === undefined ? undefined : configKey(server.config.configFile);
}

/**
 * Remember which configuration describes the run, and — for Vitest 2, whose
 * finished file carries a project's name and not the project — which
 * configuration each name stands for.
 */
export function noteRunner(run: SelectionRun, context: RunnerContext): Map<string, string> {
  run.runConfig = projectConfig(context);
  const byName = new Map<string, string>();
  for (const project of context.projects ?? []) {
    const name = project.name ?? project.getName?.();
    const config = projectConfig(project);
    if (name !== undefined && config !== undefined) byName.set(name, config);
  }
  return byName;
}

/**
 * Every file a test that ran under these configurations rests on.
 *
 * Falls back to every configuration the run declared when the runner did not
 * say which one describes it, or which one a test ran under, or named one no
 * plugin of this seam's saw resolved — a project somebody did not wrap.
 */
export function governingPreconditions(
  run: SelectionRun,
  configs: readonly string[] | undefined,
): readonly string[] {
  const known = run.runConfig !== undefined &&
    configs !== undefined && configs.length > 0 &&
    configs.every((config) => run.configs.has(config));
  const keys = known ? [run.runConfig as string, ...configs] : [...run.configs.keys()];
  const files = new Set(run.preconditions);
  for (const key of keys) for (const file of run.configs.get(key) ?? []) files.add(file);
  return [...files];
}
