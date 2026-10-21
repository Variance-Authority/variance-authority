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
 * ends with: under Vite, `testSelectionProbes` and a plugin that checks the
 * config holds no second one and has Storybook's preview rewrite edit the
 * file in place; under Rspack and webpack, a plugin that lists
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
  afterHook,
  testSelectionProbes,
  testSelectionRule,
  type HookedPlugin,
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
 * Whether `@storybook/addon-vitest` loaded the presets, inside Vitest: its
 * `storybookTest()` sets `__STORYBOOK_URL__` before it loads them as a dev
 * server's, and Vitest sets `VITEST` before it loads any config. That run is
 * the Vitest seam's to record. A dev server a Vitest global setup spawns
 * inherits both, and is left unprobed with it.
 */
function underAddonVitest(): boolean {
  return process.env['VITEST'] === 'true' && process.env['__STORYBOOK_URL__'] !== undefined;
}

/**
 * Whether this is a build the collector drives: a dev server, or
 * `storybook build --test`. The collector's `tests` is read in a later
 * process, against a Storybook already built, so the build cannot ask it;
 * Storybook's own `--test` is how a build says it is for testing.
 */
function recorded(options: PresetOptions): boolean {
  return (options.configType === 'DEVELOPMENT' || options.test === true) && !underAddonVitest();
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
 * From Storybook 9.1 on, a preview mocks a module with
 * `sb.mock(import('../lib/api'))`, and Storybook's Vite plugin
 * `storybook:mock-loader-preview` turns each call into
 * `sb.mock('../lib/api')`, so the browser never loads the module for it. It
 * does so by reprinting the whole preview through Babel, whether or not the
 * file holds such a call, and returns no map. The probes place every region
 * through the map the transforms ahead of them hand on, so behind that step
 * they would name lines the file does not have, and they stop the build
 * instead. Placed after the probes, the rewrite no longer finds the import:
 * the probes mark it as a region of its own.
 *
 * So the addon keeps Storybook's plugin where it is, and Storybook's hook
 * still decides which module is the preview, but the edit is made in place:
 * `import(` and its closing parenthesis become spaces, and the specifier
 * stays where it was written. Every other character keeps its line and its
 * column, so the step needs no map, and the probes read the preview as
 * written.
 */
const PREVIEW_REWRITE = 'storybook:mock-loader-preview';

/** What Vite hands a `transform` as `this`, as far as this reads it. */
interface Parsing {
  parse(code: string): unknown;
}

interface Node {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly [key: string]: unknown;
}

/**
 * Swaps {@link PREVIEW_REWRITE}'s `transform` handler for one that makes the
 * same edit in place. An object hook keeps its `filter` and `order`. A config
 * without the plugin is left as it is.
 */
function rewritePreviewInPlace(plugins: readonly HookedPlugin[]): void {
  const plugin = plugins.find(({ name }) => name === PREVIEW_REWRITE);
  if (plugin === undefined) return;
  afterHook(plugin, 'transform', inPlace);
}

/**
 * Storybook's handler still decides which module is the preview: it returns
 * text for that one alone, and nothing where it could not parse it. Where it
 * returns text, the text is dropped and the same calls are edited in place.
 * The edit has to leave as many `sb.mock('x')` calls as Storybook's text
 * holds; a Storybook that rewrites more than this edits stops the build,
 * rather than shipping a mock that no longer mocks.
 */
function inPlace(this: object, rewritten: unknown, [code, id]: readonly unknown[]): unknown {
  if (rewritten === null || rewritten === undefined) return rewritten;
  const text = code as string;
  const preview = `the preview ${String(id)}`;
  const written = blankMockImports(text, parsed(this, text, preview));
  const storybook = typeof rewritten === 'string' ? rewritten : (rewritten as { code?: unknown }).code;
  const theirs = mockCalls(parsed(this, String(storybook), `\`${PREVIEW_REWRITE}\`'s text for ${preview}`));
  const ours = mockCalls(parsed(this, written, `${preview} as the addon edited it`));
  if (theirs !== ours) {
    throw new Error(
      `@variance-authority/storybook-collector: \`${PREVIEW_REWRITE}\` rewrote ${theirs} \`sb.mock()\` ${theirs === 1 ? 'call' : 'calls'} ` +
        `in ${preview}, and the addon's edit in place leaves ${ours}: this Storybook rewrites calls the addon does not know.`,
    );
  }
  return written === text ? null : { code: written, map: null };
}

function parsed(context: object, code: string, what: string): Node {
  try {
    return (context as Parsing).parse(code) as Node;
  } catch (error) {
    throw new Error(`@variance-authority/storybook-collector: could not parse ${what}: ${(error as Error).message}`, { cause: error });
  }
}

/**
 * `code` with every `sb.mock(import('x'), ...)` turned into
 * `sb.mock(       'x' , ...)`: the calls Storybook rewrites, an `import()` of
 * one string literal as the first argument of `sb.mock`. A line break inside
 * the `import()` is kept.
 */
function blankMockImports(code: string, program: Node): string {
  const spans: [number, number][] = [];
  visit(program, (node) => {
    const first = mockArgument(node);
    if (first?.type !== 'ImportExpression' || (first.options ?? null) !== null) return;
    const source = first.source as Node;
    if (source.type !== 'Literal' || typeof source.value !== 'string') return;
    spans.push([first.start, source.start], [source.end, first.end]);
  });
  let written = '';
  let at = 0;
  for (const [start, end] of spans.sort(([a], [b]) => a - b)) {
    written += code.slice(at, start) + code.slice(start, end).replace(/[^\r\n]/g, ' ');
    at = end;
  }
  return written + code.slice(at);
}

/** How many `sb.mock('x')` calls, with a string as their first argument, `program` holds. */
function mockCalls(program: Node): number {
  let count = 0;
  visit(program, (node) => {
    const first = mockArgument(node);
    if (first?.type === 'Literal' && typeof first.value === 'string') count++;
  });
  return count;
}

/**
 * The first argument of a call Storybook reads as `sb.mock()`: `sb.mock`
 * named directly, and neither `sb?.mock()` nor `sb.mock?.()`, which Storybook
 * leaves alone.
 */
function mockArgument(node: Node): Node | undefined {
  if (node.type !== 'CallExpression' || node.optional === true) return undefined;
  const callee = node.callee as Node;
  if (callee.type !== 'MemberExpression' || callee.computed === true || callee.optional === true) return undefined;
  const object = callee.object as Node;
  const property = callee.property as Node;
  if (object.type !== 'Identifier' || object.name !== 'sb' || property.type !== 'Identifier' || property.name !== 'mock') return undefined;
  return (node.arguments as Node[])[0];
}

function visit(node: unknown, each: (node: Node) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) visit(item, each);
    return;
  }
  if (typeof node !== 'object' || node === null || typeof (node as Node).type !== 'string') return;
  each(node as Node);
  for (const value of Object.values(node)) if (typeof value === 'object') visit(value, each);
}

/**
 * The addon's plugin beside the probes. It refuses a config that ends with a
 * second `testSelectionProbes()`, as one `main.js` adds in its own
 * `viteFinal`, which Storybook runs after the addon's: each would probe the
 * other's probes. `added` says whether the addon added one of them, or kept
 * the one `vite.config` held. It also has Storybook's preview rewrite edit the
 * file in place, as {@link rewritePreviewInPlace} says; its config hook is
 * ordered `pre`, so that happens before the probes watch the other plugins.
 */
function addonPlugin(added: boolean) {
  return {
    name: ADDON_PLUGIN,
    configResolved: {
      order: 'pre' as const,
      handler(config: { readonly plugins: readonly HookedPlugin[] }): void {
        const probes = config.plugins.filter((plugin) => plugin.name === PROBES_PLUGIN).length;
        if (probes > 1) {
          const remedy = added
            ? `the addon adds one of them: ${REMOVE_PROBES}`
            : 'and the addon added none, since `vite.config` held one: keep one, in `vite.config` or in `main.js`';
          throw new Error(`@variance-authority/storybook-collector: the Vite config holds ${probes} \`testSelectionProbes()\`, ${remedy}`);
        }
        rewritePreviewInPlace(config.plugins);
      },
    },
  };
}

/** What each recipe option is where neither side names it. */
const DEFAULTS = { mode: 'presence', placement: 'after-transforms', include: undefined } as const;

/**
 * Refuses the probes `vite.config` holds where the addon was given a recipe
 * they do not run: the addon keeps them, so its own `mode`, `include` or
 * `placement` would be dropped without a word. An addon given none of them
 * keeps them as they are.
 */
function sameRecipe(held: TestSelectionRuleOptions, given: TestSelectionRuleOptions): void {
  const differs = (['mode', 'include', 'placement'] as const).filter(
    (key) => given[key] !== undefined && (given[key] ?? DEFAULTS[key]) !== (held[key] ?? DEFAULTS[key]),
  );
  if (differs.length === 0) return;
  const said = differs.map((key) =>
    key === 'include' ? '`include` is a function other than theirs' : `\`${key}\` is \`${given[key]}\` where theirs is \`${held[key] ?? DEFAULTS[key]}\``,
  );
  throw new Error(
    `@variance-authority/storybook-collector: \`vite.config\` holds \`testSelectionProbes()\`, which the addon keeps, ` +
      `and the addon's ${said.join(', its ')}: give both the same, or remove the addon's options and set them in \`vite.config\``,
  );
}

/**
 * The probes, unless the config already holds them as `vite.config` added
 * them: Storybook merges that file in before any `viteFinal` runs.
 */
export async function viteFinal<Config extends ViteConfig>(config: Config, options: PresetOptions): Promise<Config> {
  if (!recorded(options)) return config;
  const plugins = config.plugins ?? [];
  const held = plugins.flat(Infinity).find((plugin) => (plugin as { name?: unknown } | null)?.name === PROBES_PLUGIN) as
    | { readonly api?: { readonly options?: TestSelectionRuleOptions } }
    | undefined;
  if (held !== undefined) sameRecipe(held.api?.options ?? {}, options);
  const added = held === undefined;
  return { ...config, plugins: [...plugins, ...(added ? [testSelectionProbes(probesOptions(options))] : []), addonPlugin(added)] };
}

type Rule = ReturnType<typeof testSelectionRule>;

/** The names a config can give the probes loader: the path the rule holds, and the package's specifier. */
const PROBES_LOADERS = new Set(['@variance-authority/sense/probes-loader', testSelectionRule().use[0].loader]);

/**
 * Whether a rule runs the probes loader, in any shape a rule names one:
 * `loader`, or `use` as a string, an entry or a list, here or in a rule it
 * nests in `oneOf` or `rules`.
 */
function runsProbes(listed: unknown): boolean {
  const rule = listed as { loader?: unknown; use?: unknown; oneOf?: unknown; rules?: unknown } | null;
  if (rule === null || typeof rule !== 'object') return false;
  const names = (entry: unknown): boolean =>
    PROBES_LOADERS.has(entry as string) || PROBES_LOADERS.has((entry as { loader?: unknown } | null)?.loader as string);
  if (names(rule)) return true;
  if ((Array.isArray(rule.use) ? rule.use : [rule.use]).some(names)) return true;
  return [rule.oneOf, rule.rules].some((nested) => Array.isArray(nested) && nested.some(runsProbes));
}

/**
 * Places the probes rule in `rules` where it runs last of its phase. Loaders
 * of one phase run right to left, so a post rule goes first, after every other
 * post loader; a pre rule goes last, ahead of every other pre loader. A probes
 * rule already there stops the build: two would probe each other's probes.
 */
function place(rules: unknown[], rule: Rule): void {
  if (rules.some(runsProbes)) {
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
