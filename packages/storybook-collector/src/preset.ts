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
 * of the builder it runs. Storybook runs an addon's hooks before the ones in
 * `main.js`, so the hooks here add a plugin, which reads the config the build
 * ends with: under Vite, `testSelectionProbes` and a check that the config
 * holds no second one; under Rspack and webpack, a plugin that lists
 * `testSelectionRule` first among the rules, once every hook has run, so it
 * runs after every post loader. Both probe after every compiler the project
 * configured, so a compiler that reads syntax, such as Compiled's extractor,
 * reads the file as written. It probes the builds the collector drives,
 * `storybook build --test` and a dev server, and adds nothing to any other
 * `storybook build`, the one a team publishes. Where the build writes no map
 * a loader can read, as `storybook build --test` does, the plugin hands the
 * loaders their maps and the build still writes none. A probes rule or a
 * second `testSelectionProbes()` the config holds stops the build: the addon
 * places its own. The addon's options are the probes' own, `root`, `mode`,
 * `include` and `placement`, and `mode` has to be the one the collector's
 * `tests` reads.
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

/** The name of the plugin the addon adds beside the probes, under every builder. */
const ADDON_PLUGIN = 'variance-authority:storybook-addon';

const REMOVE_PROBES = 'remove your testSelectionProbes(); the addon places it';

/**
 * Refuses a config that ends with a second `testSelectionProbes()`, as one
 * `main.js` adds in its own `viteFinal`, which Storybook runs after the
 * addon's: each would probe the other's probes.
 */
const oneProbes = {
  name: ADDON_PLUGIN,
  configResolved(config: { readonly plugins: readonly { readonly name: string }[] }): void {
    const probes = config.plugins.filter((plugin) => plugin.name === PROBES_PLUGIN).length;
    if (probes <= 1) return;
    throw new Error(
      `@variance-authority/storybook-collector: the Vite config holds ${probes} \`testSelectionProbes()\`, and the addon ` +
        `adds one of them: ${REMOVE_PROBES}`,
    );
  },
};

/**
 * The probes, unless the config already holds them as `vite.config` added
 * them: Storybook merges that file in before any `viteFinal` runs.
 */
export async function viteFinal<Config extends ViteConfig>(config: Config, options: PresetOptions): Promise<Config> {
  if (!recorded(options)) return config;
  const plugins = config.plugins ?? [];
  const held = plugins.flat(Infinity).some((plugin) => (plugin as { name?: unknown } | null)?.name === PROBES_PLUGIN);
  return { ...config, plugins: [...plugins, ...(held ? [] : [testSelectionProbes(probesOptions(options))]), oneProbes] };
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
 * Places the probes rule in `rules` where it runs last of its phase. Loaders
 * of one phase run right to left, so a post rule goes first, after every other
 * post loader; a pre rule goes last, ahead of every other pre loader. A probes
 * rule already there stops the build: two would probe each other's probes.
 */
function place(rules: unknown[], rule: Rule): void {
  if (rules.some((listed) => runs(listed, rule.use[0].loader))) {
    throw new Error(
      '@variance-authority/storybook-collector: the config holds a `testSelectionRule()`, and the addon adds its own: ' +
        'remove your testSelectionRule(); the addon places it',
    );
  }
  if (rule.enforce === 'post') rules.unshift(rule);
  else rules.push(rule);
}

/**
 * Whether a `devtool` hands each loader the map of the loaders before it: one
 * that writes `source-map`, and keeps the loaders' maps (`module`) where it is
 * `cheap`. Rspack and webpack both decide it this way.
 */
function handsLoadersMaps(devtool: unknown): boolean {
  return typeof devtool === 'string' && devtool.includes('source-map') && (devtool.includes('module') || !devtool.includes('cheap'));
}

/** The subset of the Rspack and webpack compiler the plugin uses, so nothing here needs either. */
interface Compiler {
  readonly options: { readonly devtool?: unknown; readonly module: { rules: unknown[] } };
  readonly hooks: { readonly afterPlugins: { tap(name: string, run: () => void): void } };
  readonly webpack: { readonly SourceMapDevToolPlugin: new (options: { test: RegExp }) => { apply(compiler: Compiler): void } };
}

/**
 * The plugin that places `rule` once the compiler holds the config every hook
 * wrote, `main.js`'s included: Rspack and webpack both read `module.rules`
 * when the build starts, after `afterPlugins`. After the transforms, it hands
 * each loader the map of the loaders before it where `devtool` does not, and
 * writes no map: a `SourceMapDevToolPlugin` whose `test` no file matches.
 * Rspack and webpack both turn loader maps on for it, and it writes a map
 * only for a file its `test` matches.
 */
function probesPlugin(rule: Rule) {
  return {
    name: ADDON_PLUGIN,
    apply(compiler: Compiler): void {
      compiler.hooks.afterPlugins.tap(ADDON_PLUGIN, () => place(compiler.options.module.rules, rule));
      if (rule.enforce === 'pre' || handsLoadersMaps(compiler.options.devtool)) return;
      new compiler.webpack.SourceMapDevToolPlugin({ test: /(?!)/ }).apply(compiler);
    },
  };
}

interface RsbuildConfig {
  readonly tools?: { readonly rspack?: unknown };
}

/**
 * Rsbuild's `tools.rspack` is an object, a function or a list of either,
 * applied in order; the plugin comes in as a function at the end.
 */
export async function rsbuildFinal<Config extends RsbuildConfig>(config: Config, options: PresetOptions): Promise<Config> {
  if (!recorded(options)) return config;
  const theirs = config.tools?.rspack;
  const listed = Array.isArray(theirs) ? theirs : theirs === undefined ? [] : [theirs];
  const plugin = probesPlugin(testSelectionRule(probesOptions(options)));
  const probes = (rspack: { plugins?: unknown[] }): void => {
    rspack.plugins = [...(rspack.plugins ?? []), plugin];
  };
  return { ...config, tools: { ...config.tools, rspack: [...listed, probes] } };
}

interface WebpackConfig {
  readonly plugins?: readonly unknown[];
}

export async function webpackFinal<Config extends WebpackConfig>(config: Config, options: PresetOptions): Promise<Config> {
  if (!recorded(options)) return config;
  return { ...config, plugins: [...(config.plugins ?? []), probesPlugin(testSelectionRule(probesOptions(options)))] };
}
