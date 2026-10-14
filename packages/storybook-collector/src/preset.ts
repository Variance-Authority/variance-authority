/**
 * The Storybook preset that records what each story executed, whichever
 * builder the Storybook names.
 *
 * ```js
 * // .storybook/main.js
 * export default {
 *   addons: ['@variance-authority/storybook-collector'],
 * };
 * ```
 *
 * Storybook finds this file as the package's `preset` entry, and calls the hook
 * of the builder it runs: `viteFinal` adds `testSelectionProbes`,
 * `rsbuildFinal` and `webpackFinal` add `testSelectionRule`. Both probe after
 * every compiler the project configured, so a Compiled, Emotion or Linaria
 * extractor reads the file as written. The addon's options are the probes'
 * own, `root`, `mode`, `include` and `placement`, and `mode` has to be the one
 * the collector's `tests` reads.
 */

import {
  testSelectionProbes,
  testSelectionRule,
  type TestSelectionRuleOptions,
} from '@variance-authority/sense/journal';

/** The options an `addons` entry hands the preset, beside everything Storybook hands it. */
export type PresetOptions = TestSelectionRuleOptions;

/** The probes' options alone, out of the options Storybook merges the addon's into. */
function probesOptions(options: PresetOptions): TestSelectionRuleOptions {
  return {
    ...(options.root === undefined ? {} : { root: options.root }),
    ...(options.mode === undefined ? {} : { mode: options.mode }),
    ...(options.include === undefined ? {} : { include: options.include }),
    ...(options.placement === undefined ? {} : { placement: options.placement }),
  };
}

interface ViteConfig {
  readonly plugins?: readonly unknown[];
}

/** The name `testSelectionProbes` gives its plugin, which a config that added it by hand already holds. */
const PROBES_PLUGIN = 'variance-authority:test-selection-probes';

export async function viteFinal<Config extends ViteConfig>(config: Config, options: PresetOptions): Promise<Config> {
  const plugins = config.plugins ?? [];
  if (plugins.flat(Infinity).some((plugin) => (plugin as { name?: unknown } | null)?.name === PROBES_PLUGIN)) return config;
  return { ...config, plugins: [...plugins, testSelectionProbes(probesOptions(options))] };
}

type Rule = ReturnType<typeof testSelectionRule>;

/**
 * `rules` with the probes rule where it runs last of its phase. Loaders of one
 * phase run right to left, so a post rule goes first, after every other post
 * loader; a pre rule goes last, ahead of every other pre loader. A list that
 * already runs the probes loader is kept as it is.
 */
function withRule(rules: readonly unknown[], rule: Rule): unknown[] {
  const loader = rule.use[0].loader;
  const runs = rules.some((listed) => {
    const use = (listed as { use?: unknown } | null)?.use;
    return Array.isArray(use) && use.some((entry) => entry === loader || (entry as { loader?: unknown } | null)?.loader === loader);
  });
  if (runs) return [...rules];
  return rule.enforce === 'post' ? [rule, ...rules] : [...rules, rule];
}

/**
 * Whether a `devtool` hands each loader the map of the loaders before it: one
 * that writes `source-map`, and keeps the loaders' maps (`module`) where it is
 * `cheap`. Rspack and webpack both decide it this way.
 */
function handsLoadersMaps(devtool: unknown): boolean {
  return typeof devtool === 'string' && devtool.includes('source-map') && (devtool.includes('module') || !devtool.includes('cheap'));
}

/**
 * The `devtool` the preset sets where the build writes no map a loader can
 * read, as `storybook build --test` does: hidden, so no bundle names a map,
 * and cheap, so the map written beside each bundle holds lines alone.
 */
const PROBES_DEVTOOL = 'hidden-cheap-module-source-map';

type SourceMap = boolean | { readonly js?: unknown; readonly css?: unknown };

interface RsbuildConfig {
  readonly mode?: string;
  readonly output?: { readonly sourceMap?: SourceMap };
  readonly tools?: { readonly rspack?: unknown };
}

/** The `output.sourceMap` that hands the probes a map, or `undefined` where the config's already does. */
function rsbuildSourceMap(config: RsbuildConfig): SourceMap | undefined {
  const sourceMap = config.output?.sourceMap;
  if (sourceMap === true) return undefined;
  const js = typeof sourceMap === 'object' ? sourceMap.js : sourceMap;
  // Rsbuild writes `cheap-module-source-map` where it is not told, outside production.
  if (js === undefined && sourceMap !== false && (config.mode ?? process.env['NODE_ENV']) !== 'production') return undefined;
  if (handsLoadersMaps(js)) return undefined;
  return { ...(typeof sourceMap === 'object' ? sourceMap : {}), js: PROBES_DEVTOOL };
}

/**
 * Rsbuild's `tools.rspack` is an object, a function or a list of either,
 * applied in order. The probes come in as a function at the end, so the rule
 * is placed among every rule Rsbuild and the config wrote. After the
 * transforms, the probes need each loader's map: where the build writes none,
 * `output.sourceMap.js` becomes `hidden-cheap-module-source-map`.
 */
export async function rsbuildFinal<Config extends RsbuildConfig>(config: Config, options: PresetOptions): Promise<Config> {
  const theirs = config.tools?.rspack;
  const listed = Array.isArray(theirs) ? theirs : theirs === undefined ? [] : [theirs];
  const rule = testSelectionRule(probesOptions(options));
  const probes = (rspack: { module?: { rules?: unknown[] } }): void => {
    rspack.module = { ...rspack.module, rules: withRule(rspack.module?.rules ?? [], rule) };
  };
  const sourceMap = rule.enforce === 'post' ? rsbuildSourceMap(config) : undefined;
  return {
    ...config,
    ...(sourceMap === undefined ? {} : { output: { ...config.output, sourceMap } }),
    tools: { ...config.tools, rspack: [...listed, probes] },
  };
}

interface WebpackConfig {
  readonly devtool?: unknown;
  readonly module?: { readonly rules?: readonly unknown[] };
}

/** After the transforms, a `devtool` that hands the loaders no map becomes `hidden-cheap-module-source-map`. */
export async function webpackFinal<Config extends WebpackConfig>(config: Config, options: PresetOptions): Promise<Config> {
  const rule = testSelectionRule(probesOptions(options));
  const rules = withRule(config.module?.rules ?? [], rule);
  const devtool = rule.enforce === 'post' && !handsLoadersMaps(config.devtool) ? { devtool: PROBES_DEVTOOL } : {};
  return { ...config, ...devtool, module: { ...config.module, rules } };
}
