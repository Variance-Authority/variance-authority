/**
 * The preset adds the probes to whichever builder the Storybook names: one
 * line in `addons`, and every builder the collector drives records the same.
 */

import { describe, expect, it } from 'vitest';
import { testSelectionRule } from '@variance-authority/sense/journal';
import { rsbuildFinal, viteFinal, webpackFinal } from './preset.js';

const PROBES = /probes-loader\.js$/;
/** What Storybook hands a preset in `storybook build --test`. */
const TEST = { configType: 'PRODUCTION', test: true } as const;
/** What it hands one in a `storybook build` a team publishes. */
const PUBLISHED = { configType: 'PRODUCTION' } as const;

type Rule = { enforce?: string; use: { loader: string; options: Record<string, unknown> }[] };

/** The config Rspack reads once Rsbuild has applied every `tools.rspack` entry, in order, to `rules`. */
function rspackOf(entries: unknown, rules: unknown[] = []): { module: { rules: Rule[] }; plugins?: Plugin[] } {
  const config = { module: { rules } } as { module: { rules: unknown[] } };
  for (const entry of entries as unknown[]) {
    if (typeof entry === 'function') entry(config);
    else config.module.rules.push(...((entry as { module?: { rules?: unknown[] } }).module?.rules ?? []));
  }
  return config as { module: { rules: Rule[] }; plugins?: Plugin[] };
}

function rulesOf(entries: unknown, rules: unknown[] = []): Rule[] {
  return rspackOf(entries, rules).module.rules;
}

interface Plugin {
  apply(compiler: unknown): void;
}

/** The `SourceMapDevToolPlugin` options each plugin applied to a compiler whose `devtool` is `devtool`. */
function sourceMapPlugins(plugins: readonly Plugin[] | undefined, devtool: unknown): { test?: RegExp }[] {
  const made: { test?: RegExp }[] = [];
  const SourceMapDevToolPlugin = class {
    constructor(options: { test?: RegExp }) {
      made.push(options);
    }
    apply(): void {}
  };
  for (const plugin of plugins ?? []) plugin.apply({ options: { devtool }, webpack: { SourceMapDevToolPlugin } });
  return made;
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
];

const SWC = { test: /\.tsx$/, use: [{ loader: 'builtin:swc-loader' }] };
const THEIR_POST = { test: /\.tsx$/, enforce: 'post', use: [{ loader: 'their-post-loader' }] };

describe('rsbuildFinal', () => {
  it('lists the probes first of every rule, so they run after every post loader', async () => {
    const theirs = { module: { rules: [THEIR_POST] } };
    const config = (await rsbuildFinal({ tools: { rspack: theirs } }, TEST)) as { tools: { rspack: unknown[] } };

    expect(config.tools.rspack[0]).toBe(theirs);
    const rules = rulesOf(config.tools.rspack, [SWC]);
    expect(rules).toHaveLength(3);
    expect(rules[0]?.enforce).toBe('post');
    expect(rules[0]?.use[0]?.loader).toMatch(PROBES);
    expect(rules.slice(1)).toEqual([SWC, THEIR_POST]);
  });

  it('lists the probes last under `before-transforms`, so they run ahead of every pre loader', async () => {
    const config = (await rsbuildFinal({}, { ...TEST, placement: 'before-transforms' })) as { tools: { rspack: unknown[] } };
    const rules = rulesOf(config.tools.rspack, [SWC]);
    expect(rules[0]).toBe(SWC);
    expect(rules[1]?.enforce).toBe('pre');
  });

  it('keeps a list or a function the config already holds', async () => {
    const theirs = (): void => undefined;
    const listed = (await rsbuildFinal({ tools: { rspack: [theirs] } }, TEST)) as { tools: { rspack: unknown[] } };
    expect(listed.tools.rspack[0]).toBe(theirs);
    expect(listed.tools.rspack).toHaveLength(2);

    const bare = (await rsbuildFinal({}, TEST)) as { tools: { rspack: unknown[] } };
    expect(rulesOf(bare.tools.rspack)).toHaveLength(1);
  });

  it.each(HAND_BUILT)('refuses a probes rule the config already holds, as $name, which the addon cannot order', async ({ rule }) => {
    const theirs = { module: { rules: [rule()] } };
    const config = (await rsbuildFinal({ tools: { rspack: theirs } }, TEST)) as { tools: { rspack: unknown[] } };
    expect(() => rulesOf(config.tools.rspack)).toThrow(/remove your testSelectionRule\(\); the addon places it/);
  });

  it('hands the probes the recipe the addon was given', async () => {
    const config = (await rsbuildFinal({}, { ...TEST, mode: 'entries' })) as { tools: { rspack: unknown[] } };
    expect(rulesOf(config.tools.rspack)[0]?.use[0]?.options['mode']).toBe('entries');
  });

  it('hands the loaders maps where the build writes none, as `storybook build --test` does, and writes no map', async () => {
    const config = await rsbuildFinal({ mode: 'production', output: { sourceMap: { js: false, css: false } } }, TEST);
    expect(config.output?.sourceMap).toEqual({ js: false, css: false });
    const { plugins } = rspackOf((config as { tools: { rspack: unknown[] } }).tools.rspack);

    const [made, ...more] = sourceMapPlugins(plugins, false);
    expect(more).toEqual([]);
    expect(matchesNothing(made?.test)).toBe(true);
    expect(sourceMapPlugins(plugins, 'cheap-source-map')).toHaveLength(1);
  });

  it('adds nothing where the loaders already read maps, and needs none under `before-transforms`', async () => {
    const config = (await rsbuildFinal({}, TEST)) as { tools: { rspack: unknown[] } };
    const { plugins } = rspackOf(config.tools.rspack);
    expect(sourceMapPlugins(plugins, 'source-map')).toEqual([]);
    expect(sourceMapPlugins(plugins, 'cheap-module-source-map')).toEqual([]);

    const before = (await rsbuildFinal({}, { ...TEST, placement: 'before-transforms' })) as { tools: { rspack: unknown[] } };
    expect(sourceMapPlugins(rspackOf(before.tools.rspack).plugins, false)).toEqual([]);
  });
});

describe('webpackFinal', () => {
  it('lists the probes first of the rules webpack reads, so they run after every post loader', async () => {
    const config = (await webpackFinal({ devtool: 'source-map', module: { rules: [SWC, THEIR_POST] } }, TEST)) as { module: { rules: Rule[] } };

    expect(config.module.rules[0]?.use[0]?.loader).toMatch(PROBES);
    expect(config.module.rules.slice(1)).toEqual([SWC, THEIR_POST]);
  });

  it.each(HAND_BUILT)('refuses a probes rule the config already holds, as $name, which the addon cannot order', async ({ rule }) => {
    await expect(webpackFinal({ devtool: 'source-map', module: { rules: [rule()] } }, TEST)).rejects.toThrow(
      /remove your testSelectionRule\(\); the addon places it/,
    );
  });

  it('hands the loaders maps where the build writes none, and leaves `devtool` as it is', async () => {
    const config = (await webpackFinal({ devtool: false }, TEST)) as { devtool: unknown; plugins?: Plugin[] };
    expect(config.devtool).toBe(false);

    const [made, ...more] = sourceMapPlugins(config.plugins, false);
    expect(more).toEqual([]);
    expect(matchesNothing(made?.test)).toBe(true);
    expect(sourceMapPlugins(config.plugins, 'cheap-source-map')).toHaveLength(1);
    expect(sourceMapPlugins(config.plugins, 'cheap-module-source-map')).toEqual([]);
  });

  it('keeps the plugins the config lists, and adds none under `before-transforms`', async () => {
    const theirs = { apply: () => undefined };
    const config = (await webpackFinal({ devtool: false, plugins: [theirs] }, TEST)) as { plugins: Plugin[] };
    expect(config.plugins[0]).toBe(theirs);
    expect(config.plugins).toHaveLength(2);

    const before = { devtool: false, plugins: [theirs] };
    expect((await webpackFinal(before, { ...TEST, placement: 'before-transforms' })).plugins).toBe(before.plugins);
  });
});

describe('viteFinal', () => {
  it('adds the Vite probes plugin after the plugins the config holds', async () => {
    const theirs = { name: 'theirs' };
    const config = (await viteFinal({ plugins: [theirs] }, TEST)) as { plugins: { name: string }[] };

    expect(config.plugins.map((plugin) => plugin.name)).toEqual(['theirs', 'variance-authority:test-selection-probes']);
  });

  it('adds no second probes plugin where the config already holds one, as a hand-added one', async () => {
    const config = { plugins: [[{ name: 'variance-authority:test-selection-probes' }]] };
    expect(await viteFinal(config, TEST)).toBe(config);
  });
});

describe('which builds the addon probes', () => {
  it('probes `storybook build --test` and a dev server, which the collector drives', async () => {
    const vite = { plugins: [] };
    expect(await viteFinal(vite, TEST)).not.toBe(vite);
    expect(await viteFinal(vite, { configType: 'DEVELOPMENT' })).not.toBe(vite);
    expect(((await webpackFinal({}, { configType: 'DEVELOPMENT' })) as { module: { rules: unknown[] } }).module.rules).toHaveLength(1);
  });

  it('adds nothing to a `storybook build` a team publishes', async () => {
    const vite = { plugins: [] };
    const rsbuild = { output: { sourceMap: false } };
    const webpack = { devtool: false, module: { rules: [] } };

    expect(await viteFinal(vite, PUBLISHED)).toBe(vite);
    expect(await rsbuildFinal(rsbuild, PUBLISHED)).toBe(rsbuild);
    expect(await webpackFinal(webpack, PUBLISHED)).toBe(webpack);
  });
});
