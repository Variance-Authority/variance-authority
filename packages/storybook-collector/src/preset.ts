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
 * own, `root`, `mode` and `include`, and `mode` has to be the one the
 * collector's `tests` reads.
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
  };
}

interface ViteConfig {
  readonly plugins?: readonly unknown[];
}

export async function viteFinal<Config extends ViteConfig>(config: Config, options: PresetOptions): Promise<Config> {
  return { ...config, plugins: [...(config.plugins ?? []), testSelectionProbes(probesOptions(options))] };
}

interface RsbuildConfig {
  readonly tools?: { readonly rspack?: unknown };
}

/**
 * Rsbuild's `tools.rspack` is an object, a function or a list of either, and a
 * list is applied in order, objects merged with their rules appended: the
 * probes go last, after every change the config already makes.
 */
export async function rsbuildFinal<Config extends RsbuildConfig>(config: Config, options: PresetOptions): Promise<Config> {
  const theirs = config.tools?.rspack;
  const listed = Array.isArray(theirs) ? theirs : theirs === undefined ? [] : [theirs];
  const probes = { module: { rules: [testSelectionRule(probesOptions(options))] } };
  return { ...config, tools: { ...config.tools, rspack: [...listed, probes] } };
}

interface WebpackConfig {
  readonly module?: { readonly rules?: readonly unknown[] };
}

export async function webpackFinal<Config extends WebpackConfig>(config: Config, options: PresetOptions): Promise<Config> {
  const rules = [...(config.module?.rules ?? []), testSelectionRule(probesOptions(options))];
  return { ...config, module: { ...config.module, rules } };
}
