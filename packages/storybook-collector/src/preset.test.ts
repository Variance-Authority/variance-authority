/**
 * The preset adds the probes to whichever builder the Storybook names: one
 * line in `addons`, and every builder the collector drives records the same.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { testSelectionProbes, testSelectionRule } from '@variance-authority/sense/journal';
import { parseAst } from 'vite';
import { rsbuildFinal, viteFinal, webpackFinal } from './preset.js';

const PROBES = /probes-loader\.js$/;
/** What Storybook hands a preset in `storybook build --test`. */
const TEST = { configType: 'PRODUCTION', test: true } as const;
/** What it hands one in a `storybook build` a team publishes. */
const PUBLISHED = { configType: 'PRODUCTION' } as const;

type Rule = { enforce?: string; use: { loader: string; options: Record<string, unknown> }[] };

interface Plugin {
  readonly name?: string;
  apply(compiler: unknown): void;
}

/**
 * What a compiler holds once `plugins` are applied and `afterPlugins` has run:
 * its rules, and the `SourceMapDevToolPlugin` options each plugin applied.
 */
function compiled(plugins: readonly unknown[] | undefined, devtool: unknown, rules: unknown[] = []): { rules: Rule[]; maps: { test?: RegExp }[] } {
  const maps: { test?: RegExp }[] = [];
  const after: (() => void)[] = [];
  const SourceMapDevToolPlugin = class {
    constructor(options: { test?: RegExp }) {
      maps.push(options);
    }
    apply(): void {}
  };
  const compiler = { options: { devtool, module: { rules } }, hooks: { afterPlugins: { tap: (_: string, run: () => void) => after.push(run) } }, webpack: { SourceMapDevToolPlugin } };
  for (const plugin of (plugins ?? []) as Plugin[]) plugin.apply(compiler);
  for (const run of after) run();
  return { rules: rules as Rule[], maps };
}

/** The plugins Rspack holds once Rsbuild has applied every `tools.rspack` entry, in order. */
function rspackPlugins(entries: unknown): unknown[] {
  const config: { plugins?: unknown[] } = {};
  for (const entry of entries as unknown[]) if (typeof entry === 'function') entry(config);
  return config.plugins ?? [];
}

/** A pattern no asset name matches, so the plugin writes no map. */
function matchesNothing(test: RegExp | undefined): boolean {
  return test !== undefined && ['page.js', 'index.js', 'main.css', '', 'a'].every((name) => !test.test(name));
}

/** Every shape a rule names a loader in, each running the probes loader. */
const HAND_BUILT = [
  { name: 'a `use` list', rule: () => testSelectionRule() },
  { name: 'a `use` string', rule: () => ({ test: /\.ts$/, use: testSelectionRule().use[0].loader }) },
  { name: 'a `loader`', rule: () => ({ test: /\.ts$/, loader: testSelectionRule().use[0].loader }) },
  { name: 'a `use` entry', rule: () => ({ test: /\.ts$/, use: { loader: testSelectionRule().use[0].loader } }) },
  { name: 'the package specifier', rule: () => ({ test: /\.ts$/, loader: '@variance-authority/sense/probes-loader' }) },
  { name: 'a rule in `oneOf`', rule: () => ({ oneOf: [{ test: /\.css$/ }, testSelectionRule()] }) },
  { name: 'a rule in `rules`', rule: () => ({ test: /\.ts$/, rules: [{ oneOf: [{ use: ['@variance-authority/sense/probes-loader'] }] }] }) },
];

const SWC = { test: /\.tsx$/, use: [{ loader: 'builtin:swc-loader' }] };
const THEIR_POST = { test: /\.tsx$/, enforce: 'post', use: [{ loader: 'their-post-loader' }] };

describe('rsbuildFinal', () => {
  it('adds a plugin that lists the probes first of every rule the build ends with, so they run after every post loader', async () => {
    const theirs = { module: { rules: [THEIR_POST] } };
    const config = (await rsbuildFinal({ tools: { rspack: theirs } }, TEST)) as { tools: { rspack: unknown[] } };

    expect(config.tools.rspack[0]).toBe(theirs);
    const { rules } = compiled(rspackPlugins(config.tools.rspack), 'source-map', [SWC, THEIR_POST]);
    expect(rules).toHaveLength(3);
    expect(rules[0]?.enforce).toBe('post');
    expect(rules[0]?.use[0]?.loader).toMatch(PROBES);
    expect(rules.slice(1)).toEqual([SWC, THEIR_POST]);
  });

  it('lists the probes last under `before-transforms`, so they run ahead of every pre loader', async () => {
    const config = (await rsbuildFinal({}, { ...TEST, placement: 'before-transforms' })) as { tools: { rspack: unknown[] } };
    const { rules } = compiled(rspackPlugins(config.tools.rspack), false, [SWC]);
    expect(rules[0]).toBe(SWC);
    expect(rules[1]?.enforce).toBe('pre');
  });

  it('keeps a list or a function the config already holds', async () => {
    const theirs = (): void => undefined;
    const listed = (await rsbuildFinal({ tools: { rspack: [theirs] } }, TEST)) as { tools: { rspack: unknown[] } };
    expect(listed.tools.rspack[0]).toBe(theirs);
    expect(listed.tools.rspack).toHaveLength(2);
  });

  it.each(HAND_BUILT)('refuses a probes rule the build ends with, as $name, since the addon adds its own', async ({ rule }) => {
    const config = (await rsbuildFinal({}, TEST)) as { tools: { rspack: unknown[] } };
    expect(() => compiled(rspackPlugins(config.tools.rspack), 'source-map', [rule()])).toThrow(/remove your testSelectionRule\(\); the addon places it/);
  });

  it('hands the probes the recipe the addon was given', async () => {
    const config = (await rsbuildFinal({}, { ...TEST, mode: 'entries' })) as { tools: { rspack: unknown[] } };
    expect(compiled(rspackPlugins(config.tools.rspack), 'source-map').rules[0]?.use[0]?.options['mode']).toBe('entries');
  });

  it('hands the loaders maps where the build writes none, as `storybook build --test` does, and writes no map', async () => {
    const config = await rsbuildFinal({ mode: 'production', output: { sourceMap: { js: false, css: false } } }, TEST);
    expect(config.output?.sourceMap).toEqual({ js: false, css: false });
    const plugins = rspackPlugins((config as { tools: { rspack: unknown[] } }).tools.rspack);

    const [made, ...more] = compiled(plugins, false).maps;
    expect(more).toEqual([]);
    expect(matchesNothing(made?.test)).toBe(true);
    expect(compiled(plugins, 'cheap-source-map').maps).toHaveLength(1);
  });

  it('adds nothing where the loaders already read maps, and needs none under `before-transforms`', async () => {
    const config = (await rsbuildFinal({}, TEST)) as { tools: { rspack: unknown[] } };
    const plugins = rspackPlugins(config.tools.rspack);
    expect(compiled(plugins, 'source-map').maps).toEqual([]);
    expect(compiled(plugins, 'cheap-module-source-map').maps).toEqual([]);

    const before = (await rsbuildFinal({}, { ...TEST, placement: 'before-transforms' })) as { tools: { rspack: unknown[] } };
    expect(compiled(rspackPlugins(before.tools.rspack), false).maps).toEqual([]);
  });
});

describe('webpackFinal', () => {
  it('adds a plugin that lists the probes first of the rules webpack reads, so they run after every post loader', async () => {
    const config = await webpackFinal({ devtool: 'source-map', module: { rules: [SWC, THEIR_POST] } }, TEST);
    const { rules } = compiled(config.plugins, 'source-map', [...config.module.rules]);

    expect(config.module.rules).toEqual([SWC, THEIR_POST]);
    expect(rules[0]?.use[0]?.loader).toMatch(PROBES);
    expect(rules.slice(1)).toEqual([SWC, THEIR_POST]);
  });

  it.each(HAND_BUILT)('refuses a probes rule the build ends with, as $name, since the addon adds its own', async ({ rule }) => {
    const config = await webpackFinal({ devtool: 'source-map' }, TEST);
    expect(() => compiled(config.plugins, 'source-map', [rule()])).toThrow(/remove your testSelectionRule\(\); the addon places it/);
  });

  it('hands the loaders maps where the build writes none, and leaves `devtool` as it is', async () => {
    const config = (await webpackFinal({ devtool: false }, TEST)) as { devtool: unknown; plugins?: Plugin[] };
    expect(config.devtool).toBe(false);

    const [made, ...more] = compiled(config.plugins, false).maps;
    expect(more).toEqual([]);
    expect(matchesNothing(made?.test)).toBe(true);
    expect(compiled(config.plugins, 'cheap-source-map').maps).toHaveLength(1);
    expect(compiled(config.plugins, 'cheap-module-source-map').maps).toEqual([]);
  });

  it('keeps the plugins the config lists, and hands no maps under `before-transforms`', async () => {
    const theirs = { apply: () => undefined };
    const config = (await webpackFinal({ devtool: false, plugins: [theirs] }, TEST)) as { plugins: Plugin[] };
    expect(config.plugins[0]).toBe(theirs);
    expect(config.plugins).toHaveLength(2);

    const before = await webpackFinal({ devtool: false }, { ...TEST, placement: 'before-transforms' });
    expect(compiled(before.plugins, false).maps).toEqual([]);
  });
});

/** The plugin the addon adds beside the Vite probes, as far as these tests read it. */
type Addon = { readonly name: string; readonly configResolved: { readonly order: string; handler(config: object): void } };

describe('viteFinal', () => {
  it('adds the Vite probes plugin after the plugins the config holds', async () => {
    const theirs = { name: 'theirs' };
    const config = (await viteFinal({ plugins: [theirs] }, TEST)) as { plugins: { name: string }[] };

    expect(config.plugins.map((plugin) => plugin.name)).toEqual([
      'theirs',
      'variance-authority:test-selection-probes',
      'variance-authority:storybook-addon',
    ]);
  });

  it('adds no second probes plugin where the config already holds one, as `vite.config` adds it', async () => {
    const held = [{ name: 'variance-authority:test-selection-probes' }];
    const config = (await viteFinal({ plugins: [held] }, TEST)) as { plugins: unknown[] };
    expect(config.plugins).toEqual([held, expect.objectContaining({ name: 'variance-authority:storybook-addon' })]);
  });

  /** What Vite resolves `plugins` to: the addon's check reads them there. */
  function resolved(plugins: unknown[]): { readonly name: string }[] {
    return plugins.flat(Infinity) as { readonly name: string }[];
  }

  it('says the addon added none where `vite.config` held the probes and `main.js` added a second', async () => {
    const config = (await viteFinal({ plugins: [testSelectionProbes()] }, TEST)) as { plugins: unknown[] };
    const plugins = resolved([...config.plugins, testSelectionProbes()]);
    const addon = plugins.find((plugin) => plugin.name === 'variance-authority:storybook-addon') as unknown as Addon;

    expect(() => addon.configResolved.handler({ plugins })).toThrow(/holds 2 `testSelectionProbes\(\)`, and the addon added none.*keep one/s);
  });

  it('keeps the probes `vite.config` holds, silently, where the addon was given no recipe of its own', async () => {
    const held = testSelectionProbes({ mode: 'entries', placement: 'before-transforms' });
    const config = (await viteFinal({ plugins: [held] }, { ...TEST, root: '/elsewhere' })) as { plugins: unknown[] };
    expect(config.plugins[0]).toBe(held);
  });

  const include = (file: string): boolean => file.endsWith('.tsx');
  it.each([
    { name: 'a `mode`', held: {}, addon: { mode: 'entries' }, says: /`mode` is `entries`.*`presence`/s },
    { name: 'a `placement`', held: { placement: 'before-transforms' }, addon: { placement: 'after-transforms' }, says: /`placement` is `after-transforms`.*`before-transforms`/s },
    { name: 'an `include`', held: { include }, addon: { include: (file: string) => file.endsWith('.ts') }, says: /`include`/ },
  ] as const)('stops the build where `vite.config` holds the probes and the addon was given $name that differs', async ({ held, addon, says }) => {
    await expect(viteFinal({ plugins: [testSelectionProbes(held)] }, { ...TEST, ...addon })).rejects.toThrow(says);
  });

  it('keeps the probes `vite.config` holds where what the addon was given is what they run', async () => {
    const held = testSelectionProbes({ mode: 'entries', include });
    const config = (await viteFinal({ plugins: [held] }, { ...TEST, mode: 'entries', include, placement: 'after-transforms' })) as { plugins: unknown[] };
    expect(config.plugins[0]).toBe(held);
  });
});

describe('Storybook\'s preview rewrite, under the addon', () => {
  const PREVIEW = '/project/.storybook/preview.js';
  /**
   * Storybook's `storybook:mock-loader-preview`: it reprints the preview, and
   * no other module, with no map, naming the module of each `sb.mock(import())`.
   */
  const reprint = (code: string, id: string) =>
    id === PREVIEW ? `// reprinted\n${code.replace(/\n\n/g, '\n').replace(/sb\.mock\(\s*import\(\s*(['"][^'"]*['"])\s*\)/g, 'sb.mock($1')}` : null;
  /** What Vite hands a `transform` as `this`. */
  const context = { parse: (code: string) => parseAst(code) };

  type Handler = (code: string, id: string) => unknown;

  /** The rewrite's `transform` hook as the addon leaves it once the config resolves, and its handler called as Vite calls it. */
  async function rewritten(transform: unknown): Promise<{ hook: unknown; transform: Handler }> {
    const storybook = { name: 'storybook:mock-loader-preview', transform };
    const config = (await viteFinal({ plugins: [storybook] }, TEST)) as { plugins: { name: string }[] };
    const addon = config.plugins.find((plugin) => plugin.name === 'variance-authority:storybook-addon') as unknown as Addon;
    // Ordered `pre`, so the probes watch the rewrite as the addon leaves it.
    expect(addon.configResolved.order).toBe('pre');
    addon.configResolved.handler({ plugins: config.plugins });
    const hook = storybook.transform as Handler | { handler: Handler };
    const handler = typeof hook === 'function' ? hook : hook.handler;
    return { hook, transform: (code, id) => handler.call(context, code, id) };
  }

  it('names the mocked module where `import()` stood, moving no other character, so it needs no map', async () => {
    const { transform } = await rewritten(reprint);
    const code = "import { sb } from 'storybook/test';\n\nsb.mock(import('../lib/api'), { spy: true }); go();\nsb.mock(\n  import(\"./b\")\n);\n";
    expect(transform(code, PREVIEW)).toEqual({
      code: "import { sb } from 'storybook/test';\n\nsb.mock(       '../lib/api' , { spy: true }); go();\nsb.mock(\n         \"./b\" \n);\n",
      map: null,
    });
  });

  it('leaves the preview as written where it mocks nothing, and every other module to Storybook', async () => {
    const { transform } = await rewritten(reprint);
    const kept = "sb.mock('../lib/api');\nsb.spy(import('./a'));\nother.mock(import('./b'));\nsb.mock(import(name));\n";
    expect(transform(kept, PREVIEW)).toBeNull();
    expect(transform("sb.mock(import('./a'));\n", '/project/src/a.js')).toBeNull();
  });

  it('keeps the `filter` and `order` of an object hook, as Storybook 10 writes it', async () => {
    const filter = { id: /preview/ };
    const { hook, transform } = await rewritten({ filter, order: 'pre', handler: reprint });
    expect(hook).toMatchObject({ filter, order: 'pre' });
    expect(transform("sb.mock(import('./a'));\n", PREVIEW)).toEqual({ code: "sb.mock(       './a' );\n", map: null });
  });

  it('leaves a config without Storybook\'s preview rewrite as it is', async () => {
    const other = { name: 'other', transform: reprint };
    const config = (await viteFinal({ plugins: [other] }, TEST)) as { plugins: { name: string }[] };
    const addon = config.plugins.find((plugin) => plugin.name === 'variance-authority:storybook-addon') as unknown as Addon;
    addon.configResolved.handler({ plugins: config.plugins });
    expect(other.transform).toBe(reprint);
  });

  it('waits for a Storybook that answers a promise', async () => {
    const { transform } = await rewritten(async (code: string, id: string) => reprint(code, id));
    await expect(transform("sb.mock(import('./a'));\n", PREVIEW)).resolves.toEqual({ code: "sb.mock(       './a' );\n", map: null });
  });

  it('leaves `sb?.mock()` and `sb.mock?.()` as written, as Storybook does', async () => {
    const { transform } = await rewritten(reprint);
    expect(transform("sb?.mock(import('./a'));\nsb.mock?.(import('./b'));\n", PREVIEW)).toBeNull();
  });

  it('stops the build where Storybook rewrote a call the edit in place does not', async () => {
    const widened = (code: string, id: string) => reprint(code.replace('sb?.mock(', 'sb.mock('), id);
    const { transform } = await rewritten(widened);
    expect(() => transform("sb?.mock(import('./a'));\n", PREVIEW)).toThrow(
      `\`storybook:mock-loader-preview\` rewrote 1 \`sb.mock()\` call in the preview ${PREVIEW}, and the addon's edit in place leaves 0`,
    );
  });

  it('names the preview it could not parse', async () => {
    const { transform } = await rewritten(reprint);
    expect(() => transform("sb.mock(import('./a');\n", PREVIEW)).toThrow(`could not parse the preview ${PREVIEW}: `);
  });
});

describe('which builds the addon probes', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('probes `storybook build --test` and a dev server, which the collector drives', async () => {
    const vite = { plugins: [] };
    expect(await viteFinal(vite, TEST)).not.toBe(vite);
    expect(await viteFinal(vite, { configType: 'DEVELOPMENT' })).not.toBe(vite);
    expect(compiled((await webpackFinal({}, { configType: 'DEVELOPMENT' })).plugins, 'source-map').rules).toHaveLength(1);
  });

  it('adds nothing to a `storybook build` a team publishes', async () => {
    const vite = { plugins: [] };
    const rsbuild = { output: { sourceMap: false } };
    const webpack = { devtool: false, module: { rules: [] } };

    expect(await viteFinal(vite, PUBLISHED)).toBe(vite);
    expect(await rsbuildFinal(rsbuild, PUBLISHED)).toBe(rsbuild);
    expect(await webpackFinal(webpack, PUBLISHED)).toBe(webpack);
  });

  it('adds nothing to the Vite config `@storybook/addon-vitest` loads the presets for, inside Vitest', async () => {
    // What the addon's `storybookTest()` sets before it loads the presets as a dev server's.
    vi.stubEnv('__STORYBOOK_URL__', 'http://localhost:6006');
    vi.stubEnv('VITEST', 'true');
    const vite = { plugins: [] };
    expect(await viteFinal(vite, { configType: 'DEVELOPMENT' })).toBe(vite);
  });
});
