/**
 * The preset adds the probes to whichever builder the Storybook names: one
 * line in `addons`, and every builder the collector drives records the same.
 */

import { describe, expect, it } from 'vitest';
import { rsbuildFinal, viteFinal, webpackFinal } from './preset.js';

const PROBES = /probes-loader\.js$/;

/** The rules an Rsbuild `tools.rspack` entry list adds, in order. */
function rulesOf(entries: unknown): { enforce?: string; use: { loader: string; options: Record<string, unknown> }[] }[] {
  return (entries as { module?: { rules?: never[] } }[]).flatMap((entry) => entry.module?.rules ?? []);
}

describe('rsbuildFinal', () => {
  it('appends the probes rule after every Rspack change the config already makes', async () => {
    const theirs = { module: { rules: [{ test: /\.tsx$/, use: [] }] } };
    const config = (await rsbuildFinal({ tools: { rspack: theirs } }, {})) as { tools: { rspack: unknown[] } };

    expect(config.tools.rspack[0]).toBe(theirs);
    const rules = rulesOf(config.tools.rspack.slice(1));
    expect(rules).toHaveLength(1);
    expect(rules[0]?.enforce).toBe('post');
    expect(rules[0]?.use[0]?.loader).toMatch(PROBES);
  });

  it('keeps a list or a function the config already holds', async () => {
    const theirs = (): void => undefined;
    const listed = (await rsbuildFinal({ tools: { rspack: [theirs] } }, {})) as { tools: { rspack: unknown[] } };
    expect(listed.tools.rspack[0]).toBe(theirs);
    expect(listed.tools.rspack).toHaveLength(2);

    const bare = (await rsbuildFinal({}, {})) as { tools: { rspack: unknown[] } };
    expect(rulesOf(bare.tools.rspack)).toHaveLength(1);
  });

  it('hands the probes the recipe the addon was given', async () => {
    const config = (await rsbuildFinal({}, { mode: 'entries' })) as { tools: { rspack: unknown[] } };
    expect(rulesOf(config.tools.rspack)[0]?.use[0]?.options['mode']).toBe('entries');
  });

  it('hands the probes the placement the addon was given', async () => {
    const config = (await rsbuildFinal({}, { placement: 'before-transforms' })) as { tools: { rspack: unknown[] } };
    expect(rulesOf(config.tools.rspack)[0]?.enforce).toBe('pre');
  });
});

describe('webpackFinal', () => {
  it('adds the probes rule to the rules webpack already reads', async () => {
    const theirs = { test: /\.tsx$/, use: [] };
    const config = (await webpackFinal({ module: { rules: [theirs] } }, {})) as { module: { rules: unknown[] } };

    expect(config.module.rules[0]).toBe(theirs);
    expect(rulesOf([config])[1]?.use[0]?.loader).toMatch(PROBES);
  });
});

describe('viteFinal', () => {
  it('adds the Vite probes plugin after the plugins the config holds', async () => {
    const theirs = { name: 'theirs' };
    const config = (await viteFinal({ plugins: [theirs] }, {})) as { plugins: { name: string }[] };

    expect(config.plugins.map((plugin) => plugin.name)).toEqual(['theirs', 'variance-authority:test-selection-probes']);
  });
});
