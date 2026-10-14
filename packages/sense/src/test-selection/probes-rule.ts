/**
 * The rule that probes a build Rspack or webpack bundles, for a page no test
 * runner drives: a Storybook, an application under Playwright.
 *
 * The loader runs at `enforce: 'post'`, after SWC, Babel and every loader the
 * project configured, so a compiler that reads syntax never reads a probe; the
 * placement is the one every Rspack seam shares
 * ([`loader-probes.ts`](./loader-probes.ts)). With `placement:
 * 'before-transforms'` it runs at `enforce: 'pre'` on the file as read. Each probed module opens with an
 * import of the page collector, served by the same loader, as
 * `testSelectionProbes` opens each with its virtual module under Vite.
 */

import { fileURLToPath } from 'node:url';
import type { InstrumentMode } from '../instrument/index.js';
import type { ProbePlacement } from './instrumented-modules.js';
import { repositoryRoot } from './repository-root.js';

/** What `testSelectionRule` takes: where names start, which modules are yours, and the probe recipe. */
export interface TestSelectionRuleOptions {
  /**
   * A directory inside the repository; defaults to the current directory.
   * Names are relative to the checkout it sits in, never to it.
   */
  readonly root?: string;
  /** Decide which modules are product source; defaults to every file outside `node_modules` and `dist` that is not a test or a config. */
  readonly include?: (file: string) => boolean;
  /** The probe recipe, as `testSelectionProbes` takes it: one answer for every seam that shares a coverage file. */
  readonly mode?: InstrumentMode;
  /**
   * Where the probes go: after the project's loaders, the default, or ahead of
   * them, one parse and no map, for a build whose loaders only strip types or
   * JSX. A compiler that reads syntax then reads the probes.
   */
  readonly placement?: ProbePlacement;
}

/** What the loader reads: data only, since Rspack hands loader options to its core and back. */
export interface ProbesLoaderOptions {
  /** The checkout's root. */
  readonly root?: string;
  readonly mode?: InstrumentMode;
  /** The key {@link testSelectionRule} registered `include` under, in this realm. */
  readonly include?: string;
  readonly placement?: ProbePlacement;
}

/** A rule for `module.rules`, in the shape Rspack and webpack both read. */
export interface TestSelectionRule {
  readonly test: RegExp;
  readonly enforce: 'pre' | 'post';
  readonly use: readonly [{ readonly loader: string; readonly options: ProbesLoaderOptions }];
}

/** The loader, by absolute path. */
export const PROBES_LOADER = fileURLToPath(new URL('./probes-loader.js', import.meta.url));

/** The file the loader serves the page collector as: a module for a bundler to resolve, whose text the loader writes. */
export const COLLECTOR_FILE = fileURLToPath(new URL('./probes-collector.js', import.meta.url));

/**
 * The rule that probes every module the project's loaders wrote.
 *
 * ```js
 * // rspack.config.mjs
 * import { testSelectionRule } from '@variance-authority/sense/journal';
 *
 * export default {
 *   module: { rules: [...yourRules, testSelectionRule()] },
 * };
 * ```
 *
 * Leave `devtool` writing source maps: the probes go where the map the loaders
 * hand on says each region of the file went, and a module that arrives with no
 * map stops the build by name. `include` is a function, and loader options
 * cross into Rspack's core as data, so the rule carries a key to it, which the
 * loader finds in this process: a loader run in a worker cannot.
 */
export function testSelectionRule(options: TestSelectionRuleOptions = {}): TestSelectionRule {
  const loaderOptions: ProbesLoaderOptions = {
    root: repositoryRoot(options.root ?? process.cwd()),
    ...(options.mode === undefined ? {} : { mode: options.mode }),
    ...(options.include === undefined ? {} : { include: registered(options.include) }),
    ...(options.placement === undefined ? {} : { placement: options.placement }),
  };
  const enforce = options.placement === 'before-transforms' ? 'pre' : 'post';
  return { test: /\.[cm]?[jt]sx?$/, enforce, use: [{ loader: PROBES_LOADER, options: loaderOptions }] };
}

/** Every `include` a rule in this realm carries, by key. Global, so two copies of this module share it. */
const INCLUDES = Symbol.for('@variance-authority/sense/probes-loader#include');

function includes(): Map<string, (file: string) => boolean> {
  const realm = globalThis as { [INCLUDES]?: Map<string, (file: string) => boolean> };
  return (realm[INCLUDES] ??= new Map());
}

function registered(include: (file: string) => boolean): string {
  const known = includes();
  for (const [key, value] of known) if (value === include) return key;
  const key = `include-${known.size + 1}`;
  known.set(key, include);
  return key;
}

/** The `include` a rule registered under `key`; throws where this realm holds none. */
export function includeOf(key: string): (file: string) => boolean {
  const include = includes().get(key);
  if (include !== undefined) return include;
  throw new Error(
    `variance-authority: the probes loader was handed \`include\` ${JSON.stringify(key)}, which no \`testSelectionRule\` ` +
      'registered in this process. A loader run in a worker, such as under `thread-loader` or Rspack\'s parallel loaders, ' +
      'cannot reach the function: run the probes loader on the main thread, or leave `include` out.',
  );
}
