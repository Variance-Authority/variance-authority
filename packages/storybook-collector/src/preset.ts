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
 * `rsbuildFinal` and `webpackFinal` add `testSelectionRule`, first among the
 * rules so it runs after every post loader. Both probe after every compiler the
 * project configured, so a compiler that reads syntax, such as Compiled's
 * extractor, reads the file as written. It probes the builds the collector drives,
 * `storybook build --test` and a dev server, and adds nothing to any other
 * `storybook build`, the one a team publishes. Where the build writes no map
 * a loader can read, as `storybook build --test` does, the rule's hooks hand
 * the loaders their maps and the build still writes none. A
 * `testSelectionRule()` the config already holds stops the build, because the
 * addon cannot order it. The addon's options are the probes' own, `root`,
 * `mode`, `include` and `placement`, and `mode` has to be the one the
 * collector's `tests` reads.
 */

import {
  testSelectionProbes,
  testSelectionRule,
  type TestSelectionRuleOptions,
} from '@variance-authority/sense/journal';

/** The options an `addons` entry hands the preset, beside everything Storybook hands it. */
export interface PresetOptions extends TestSelectionRuleOptions {
  /** Storybook's: `DEVELOPMENT` for a dev server, `PRODUCTION` for `storybook build`. */
  readonly configType?: string;
  /** Storybook's: whether `storybook build` was given `--test`. */
  readonly test?: boolean;
}

/**
 * Whether this is a build the collector drives: a dev server, or
 * `storybook build --test`. The collector's `tests` is read in a later
 * process, against a Storybook already built, so the build cannot ask it;
 * Storybook's own `--test` is how a build says it is for testing.
 */
function recorded(options: PresetOptions): boolean {
  return options.configType === 'DEVELOPMENT' || options.test === true;
}

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
  if (!recorded(options)) return config;
  const plugins = config.plugins ?? [];
  if (plugins.flat(Infinity).some((plugin) => (plugin as { name?: unknown } | null)?.name === PROBES_PLUGIN)) return config;
  return { ...config, plugins: [...plugins, testSelectionProbes(probesOptions(options))] };
}

type Rule = ReturnType<typeof testSelectionRule>;

/** Whether a rule runs `loader`, in any shape a rule names one: `loader`, or `use` as a string, an entry or a list. */
function runs(listed: unknown, loader: string): boolean {
  const rule = listed as { loader?: unknown; use?: unknown } | null;
  if (rule?.loader === loader) return true;
  const use = rule?.use;
  return (Array.isArray(use) ? use : [use]).some((entry) => entry === loader || (entry as { loader?: unknown } | null)?.loader === loader);
}

/**
 * `rules` with the probes rule where it runs last of its phase. Loaders of one
 * phase run right to left, so a post rule goes first, after every other post
 * loader; a pre rule goes last, ahead of every other pre loader. A probes rule
 * the config already holds stops the build: the addon cannot know where it
 * runs, and behind a post loader of the project's it reads probes.
 */
function withRule(rules: readonly unknown[], rule: Rule): unknown[] {
  if (rules.some((listed) => runs(listed, rule.use[0].loader))) {
    throw new Error(
      '@variance-authority/storybook-collector: the config already holds a `testSelectionRule()`, which the addon ' +
        'cannot order after your post loaders: remove your testSelectionRule(); the addon places it',
    );
  }
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

interface Compiler {
  readonly options: { readonly devtool?: unknown };
  readonly webpack: { readonly SourceMapDevToolPlugin: new (options: { test: RegExp }) => { apply(compiler: Compiler): void } };
}

/**
 * Hands each loader the map of the loaders before it where the compiler's
 * `devtool` does not, and writes no map: a `SourceMapDevToolPlugin` whose
 * `test` no file matches. Rspack and webpack both turn loader maps on for it,
 * and it writes a map only for a file its `test` matches. Read from the
 * compiler, so it is the `devtool` the build ends with.
 */
const loaderMaps = {
  name: 'variance-authority:loader-maps',
  apply(compiler: Compiler): void {
    if (handsLoadersMaps(compiler.options.devtool)) return;
    new compiler.webpack.SourceMapDevToolPlugin({ test: /(?!)/ }).apply(compiler);
  },
};

interface RsbuildConfig {
  readonly tools?: { readonly rspack?: unknown };
}

/**
 * Rsbuild's `tools.rspack` is an object, a function or a list of either,
 * applied in order. The probes come in as a function at the end, so the rule
 * is placed among every rule Rsbuild and the config wrote. After the
 * transforms, the probes need each loader's map, which {@link loaderMaps}
 * hands them where `output.sourceMap` does not.
 */
export async function rsbuildFinal<Config extends RsbuildConfig>(config: Config, options: PresetOptions): Promise<Config> {
  if (!recorded(options)) return config;
  const theirs = config.tools?.rspack;
  const listed = Array.isArray(theirs) ? theirs : theirs === undefined ? [] : [theirs];
  const rule = testSelectionRule(probesOptions(options));
  const probes = (rspack: { module?: { rules?: unknown[] }; plugins?: unknown[] }): void => {
    rspack.module = { ...rspack.module, rules: withRule(rspack.module?.rules ?? [], rule) };
    if (rule.enforce === 'post') rspack.plugins = [...(rspack.plugins ?? []), loaderMaps];
  };
  return { ...config, tools: { ...config.tools, rspack: [...listed, probes] } };
}

interface WebpackConfig {
  readonly module?: { readonly rules?: readonly unknown[] };
  readonly plugins?: readonly unknown[];
}

/** After the transforms, {@link loaderMaps} hands the loaders maps where `devtool` does not. */
export async function webpackFinal<Config extends WebpackConfig>(config: Config, options: PresetOptions): Promise<Config> {
  if (!recorded(options)) return config;
  const rule = testSelectionRule(probesOptions(options));
  const rules = withRule(config.module?.rules ?? [], rule);
  const plugins = rule.enforce === 'post' ? { plugins: [...(config.plugins ?? []), loaderMaps] } : {};
  return { ...config, ...plugins, module: { ...config.module, rules } };
}
