/**
 * The preset adds the probes to whichever builder the Storybook names: one
 * line in `addons`, and every builder the collector drives records the same.
 */

import { describe, expect, it } from 'vitest';
import { testSelectionRule } from '@variance-authority/sense/journal';
import { rsbuildFinal, viteFinal, webpackFinal } from './preset.js';

const PROBES = /probes-loader\.js$/;

type Rule = { enforce?: string; use: { loader: string; options: Record<string, unknown> }[] };

/** The rules Rspack reads once Rsbuild has applied every `tools.rspack` entry, in order, to `rules`. */
function rulesOf(entries: unknown, rules: unknown[] = []): Rule[] {
  const config = { module: { rules } } as { module: { rules: unknown[] } };
  for (const entry of entries as unknown[]) {
    if (typeof entry === 'function') entry(config);
    else config.module.rules.push(...((entry as { module?: { rules?: unknown[] } }).module?.rules ?? []));
  }
  return config.module.rules as Rule[];
}

const SWC = { test: /\.tsx$/, use: [{ loader: 'builtin:swc-loader' }] };
const THEIR_POST = { test: /\.tsx$/, enforce: 'post', use: [{ loader: 'their-post-loader' }] };

describe('rsbuildFinal', () => {
  it('lists the probes first of every rule, so they run after every post loader', async () => {
    const theirs = { module: { rules: [THEIR_POST] } };
    const config = (await rsbuildFinal({ tools: { rspack: theirs } }, {})) as { tools: { rspack: unknown[] } };

    expect(config.tools.rspack[0]).toBe(theirs);
    const rules = rulesOf(config.tools.rspack, [SWC]);
    expect(rules).toHaveLength(3);
    expect(rules[0]?.enforce).toBe('post');
    expect(rules[0]?.use[0]?.loader).toMatch(PROBES);
    expect(rules.slice(1)).toEqual([SWC, THEIR_POST]);
  });

  it('lists the probes last under `before-transforms`, so they run ahead of every pre loader', async () => {
    const config = (await rsbuildFinal({}, { placement: 'before-transforms' })) as { tools: { rspack: unknown[] } };
    const rules = rulesOf(config.tools.rspack, [SWC]);
    expect(rules[0]).toBe(SWC);
    expect(rules[1]?.enforce).toBe('pre');
  });

  it('keeps a list or a function the config already holds', async () => {
    const theirs = (): void => undefined;
    const listed = (await rsbuildFinal({ tools: { rspack: [theirs] } }, {})) as { tools: { rspack: unknown[] } };
    expect(listed.tools.rspack[0]).toBe(theirs);
    expect(listed.tools.rspack).toHaveLength(2);

    const bare = (await rsbuildFinal({}, {})) as { tools: { rspack: unknown[] } };
    expect(rulesOf(bare.tools.rspack)).toHaveLength(1);
  });

  it('adds no second rule where the config already runs the probes loader', async () => {
    const theirs = { module: { rules: [testSelectionRule()] } };
    const config = (await rsbuildFinal({ tools: { rspack: theirs } }, {})) as { tools: { rspack: unknown[] } };
    expect(rulesOf(config.tools.rspack)).toHaveLength(1);
  });

  it('hands the probes the recipe the addon was given', async () => {
    const config = (await rsbuildFinal({}, { mode: 'entries' })) as { tools: { rspack: unknown[] } };
    expect(rulesOf(config.tools.rspack)[0]?.use[0]?.options['mode']).toBe('entries');
  });

  it('turns a production build\'s source maps on where it writes none, as `storybook build --test` does', async () => {
    const config = await rsbuildFinal({ mode: 'production', output: { sourceMap: { js: false, css: false } } }, {});
    expect(config.output?.sourceMap).toEqual({ js: 'hidden-cheap-module-source-map', css: false });

    const off = await rsbuildFinal({ mode: 'production', output: { sourceMap: false } }, {});
    expect(off.output?.sourceMap).toEqual({ js: 'hidden-cheap-module-source-map' });

    const unset = await rsbuildFinal({ mode: 'production' }, {});
    expect(unset.output?.sourceMap).toEqual({ js: 'hidden-cheap-module-source-map' });
  });

  it('keeps source maps the loaders already read, and needs none under `before-transforms`', async () => {
    const written = { mode: 'production', output: { sourceMap: { js: 'source-map' } } };
    expect((await rsbuildFinal(written, {})).output).toBe(written.output);
    expect((await rsbuildFinal({ mode: 'development' }, {})).output).toBeUndefined();
    expect((await rsbuildFinal({ mode: 'production', output: { sourceMap: false } }, { placement: 'before-transforms' })).output?.sourceMap).toBe(false);
  });
});

describe('webpackFinal', () => {
  it('lists the probes first of the rules webpack reads, so they run after every post loader', async () => {
    const config = (await webpackFinal({ devtool: 'source-map', module: { rules: [SWC, THEIR_POST] } }, {})) as { module: { rules: Rule[] } };

    expect(config.module.rules[0]?.use[0]?.loader).toMatch(PROBES);
    expect(config.module.rules.slice(1)).toEqual([SWC, THEIR_POST]);
  });

  it('adds no second rule where the config already runs the probes loader', async () => {
    const config = (await webpackFinal({ devtool: 'source-map', module: { rules: [testSelectionRule()] } }, {})) as { module: { rules: Rule[] } };
    expect(config.module.rules).toHaveLength(1);
  });

  it('turns a production build\'s source maps on where it writes none', async () => {
    expect((await webpackFinal({ devtool: false }, {})).devtool).toBe('hidden-cheap-module-source-map');
    expect((await webpackFinal({ devtool: 'cheap-source-map' }, {})).devtool).toBe('hidden-cheap-module-source-map');
    expect((await webpackFinal({ devtool: 'cheap-module-source-map' }, {})).devtool).toBe('cheap-module-source-map');
    expect((await webpackFinal({ devtool: false }, { placement: 'before-transforms' })).devtool).toBe(false);
  });
});

describe('viteFinal', () => {
  it('adds the Vite probes plugin after the plugins the config holds', async () => {
    const theirs = { name: 'theirs' };
    const config = (await viteFinal({ plugins: [theirs] }, {})) as { plugins: { name: string }[] };

    expect(config.plugins.map((plugin) => plugin.name)).toEqual(['theirs', 'variance-authority:test-selection-probes']);
  });

  it('adds no second probes plugin where the config already holds one, as a hand-added one', async () => {
    const config = { plugins: [[{ name: 'variance-authority:test-selection-probes' }]] };
    expect(await viteFinal(config, {})).toBe(config);
  });
});
