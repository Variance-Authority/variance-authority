/**
 * The rule that probes a build Rspack or webpack bundles, for a page no test
 * runner drives: a Storybook, an application under Playwright.
 *
 * The loader runs at `enforce: 'post'`, after SWC, Babel and every loader the
 * project configured, so a compiler that reads syntax never reads a probe; the
 * placement is the one every Rspack seam shares
 * ([`loader-probes.ts`](./loader-probes.ts)). With `placement:
 * 'before-transforms'` it runs at `enforce: 'pre'` on the file as read. Each
 * probed module takes the page collector, served by the same loader — an
 * `import` at its end, or a `require` after a CommonJS script's directives — as
 * `testSelectionProbes` ends each with its virtual module under Vite.
 */

import { fileURLToPath } from 'node:url';
import type { InstrumentMode } from '../instrument/index.js';
import type { ProbePlacement } from './instrumented-modules.js';
import { repositoryRoot } from './repository-root.js';

/**
 * What `testSelectionRule` takes: where names start, which modules are yours,
 * the probe recipe, and where the probes go — after the project's loaders,
 * or ahead of them.
 */
export interface TestSelectionRuleOptions {
  /**
   * A directory inside the repository; defaults to the current directory.
   * Names are relative to the checkout it sits in, never to it.
   */
  readonly root?: string;
  /**
   * Decide which modules are product source; defaults to every file outside
   * `node_modules` and `dist` that is not a test or a config. Given, it is the
   * rule's own condition, asked of each file before the loader runs: a built
   * package's file it takes is named by the sources its map lists.
   */
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
  /**
   * `'rule'` where the rule's condition is the project's `include`: the loader
   * then probes every module it is handed. Absent, it asks the default.
   */
  readonly include?: 'rule';
  readonly placement?: ProbePlacement;
}

/** A rule for `module.rules`, in the shape Rspack and webpack both read. */
export interface TestSelectionRule {
  readonly test: RegExp;
  /** `node_modules`, where `include` is the default and would refuse every file in it: Rspack then never hands one over. */
  readonly exclude?: RegExp;
  /** The project's `include`, where it gave one: Rspack and webpack ask it of each file, in the process that built the rule. */
  readonly include?: (file: string) => boolean;
  readonly enforce: 'pre' | 'post';
  readonly use: [{ readonly loader: string; readonly options: ProbesLoaderOptions }];
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
 *   module: { rules: [testSelectionRule(), ...yourRules] },
 * };
 * ```
 *
 * Loaders of one `enforce` run right to left. At the default placement the
 * rule is a `post` loader and goes first: a project's `post` loader listed
 * ahead of it would run after the probes and read them. With
 * `placement: 'before-transforms'` it is a `pre` loader and goes last, so it
 * runs ahead of every `pre` loader of the project's. With the default
 * `include`, it excludes `node_modules`.
 *
 * Leave `devtool` writing source maps: the probes go where the map the loaders
 * hand on says each region of the file went, and a module that arrives with no
 * map stops the build by name. `include`, a function, is the rule's own
 * condition and never a loader option, which crosses into Rspack's core as
 * data: the loader runs in a worker as well as on the main thread.
 */
export function testSelectionRule(options: TestSelectionRuleOptions = {}): TestSelectionRule {
  const loaderOptions: ProbesLoaderOptions = {
    root: repositoryRoot(options.root ?? process.cwd()),
    ...(options.mode === undefined ? {} : { mode: options.mode }),
    ...(options.include === undefined ? {} : { include: 'rule' as const }),
    ...(options.placement === undefined ? {} : { placement: options.placement }),
  };
  const enforce = options.placement === 'before-transforms' ? 'pre' : 'post';
  const test = /\.[cm]?[jt]sx?$/;
  const use: TestSelectionRule['use'] = [{ loader: PROBES_LOADER, options: loaderOptions }];
  return options.include === undefined ? { test, exclude: /[\\/]node_modules[\\/]/, enforce, use } : { test, include: options.include, enforce, use };
}
