/**
 * The preset's rule in a real Rspack build, next to a post loader of the
 * project's that cannot read a probe, and in a production build that writes no
 * source map, as `storybook build --test` does; and the preset loaded as
 * Storybook loads it, ahead of the hooks of the project's `main.js`.
 */

import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createRsbuild, type RsbuildConfig } from '@rsbuild/core';
import { rspack, type Configuration } from '@rspack/core';
import { loadAllPresets } from 'storybook/internal/common';
import { resolveConfig, type InlineConfig } from 'vite';
import { afterAll, describe, expect, it } from 'vitest';
import { rsbuildFinal, webpackFinal } from './preset.js';

/** What Storybook hands the preset for `storybook build --test`. */
const TEST = { configType: 'PRODUCTION', test: true } as const;

const temporary: string[] = [];

afterAll(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

/** A project with one branching module and a post loader that refuses any text holding a probe. */
async function project(): Promise<{ root: string; refuses: string }> {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), 'variance-authority-preset-')));
  temporary.push(root);
  await mkdir(resolve(root, 'src'), { recursive: true });
  await writeFile(resolve(root, 'src/tone.ts'), 'export function tone(on: boolean): string {\n  if (on) return "red";\n  return "blue";\n}\n');
  await writeFile(resolve(root, 'src/main.ts'), 'import { tone } from "./tone";\n(globalThis as { pressed?: string }).pressed = tone(true);\n');
  const refuses = resolve(root, 'refuses-probes.cjs');
  await writeFile(
    refuses,
    'module.exports = function (code, map) {\n' +
      '  if (code.includes("__va(")) throw new Error("refuses-probes: read a probe in " + this.resourcePath);\n' +
      '  this.callback(null, code, map);\n' +
      '};\n',
  );
  return { root, refuses };
}

/** Every JavaScript file the build wrote, joined. */
async function emitted(directory: string): Promise<string> {
  const files = (await readdir(directory)).filter((file) => file.endsWith('.js'));
  return (await Promise.all(files.map((file) => readFile(resolve(directory, file), 'utf8')))).join('\n');
}

async function built(config: Configuration): Promise<void> {
  const compiler = rspack(config);
  const stats = await new Promise<{ hasErrors(): boolean; toString(options: object): string }>((done, fail) =>
    compiler.run((error, result) => (error ? fail(error) : done(result!))),
  );
  await new Promise((done) => compiler.close(done));
  if (stats.hasErrors()) throw new Error(stats.toString({ all: false, errors: true }));
}

function webpackShaped(root: string, refuses: string, devtool: Configuration['devtool'], mode: 'development' | 'production'): Configuration {
  return {
    mode,
    context: root,
    devtool,
    target: 'web',
    entry: './src/main.ts',
    output: { path: resolve(root, 'out'), filename: 'page.js' },
    resolve: { extensions: ['.ts', '.js'] },
    optimization: { minimize: false },
    module: {
      rules: [
        { test: /\.ts$/, use: [{ loader: 'builtin:swc-loader', options: { jsc: { parser: { syntax: 'typescript' } } } }] },
        { test: /\.ts$/, enforce: 'post', use: [{ loader: refuses }] },
      ],
    },
  };
}

async function rsbuilt(config: RsbuildConfig, root: string): Promise<void> {
  const rsbuild = await createRsbuild({ cwd: root, rsbuildConfig: config, loadEnv: false });
  const { close } = await rsbuild.build();
  await close();
}

function rsbuildShaped(root: string, refuses: string, sourceMap: NonNullable<RsbuildConfig['output']>['sourceMap'], mode: 'development' | 'production'): RsbuildConfig {
  return {
    mode,
    logLevel: 'silent',
    source: { entry: { index: './src/main.ts' } },
    output: { distPath: { root: resolve(root, 'out'), js: '' }, filenameHash: false, minify: false, sourceMap },
    performance: { chunkSplit: { strategy: 'all-in-one' } },
    tools: { htmlPlugin: false, rspack: { module: { rules: [{ test: /\.ts$/, enforce: 'post', use: [{ loader: refuses }] }] } } },
  };
}

/** Every file the build wrote, by name, with the page's text. */
async function written(directory: string, page = 'page.js'): Promise<{ files: string[]; page: string }> {
  return { files: (await readdir(directory)).sort(), page: await readFile(resolve(directory, page), 'utf8') };
}

describe('webpackFinal in a real Rspack build', () => {
  it('runs the probes after a post loader the project lists, so it reads no probe', async () => {
    const { root, refuses } = await project();
    await built(await webpackFinal(webpackShaped(root, refuses, 'source-map', 'development'), { root, configType: 'DEVELOPMENT' }));
    expect(await emitted(resolve(root, 'out'))).toMatch(/__va\(\d+\)/);
  }, 60_000);

  it('hands the loaders maps in a production build that writes none, and still writes no map', async () => {
    const { root, refuses } = await project();
    await built(await webpackFinal(webpackShaped(root, refuses, false, 'production'), { root, ...TEST }));
    const out = await written(resolve(root, 'out'));
    // The probes land where they land in a build that writes its maps.
    const mapped = await project();
    await built(await webpackFinal(webpackShaped(mapped.root, mapped.refuses, 'hidden-source-map', 'production'), { root: mapped.root, ...TEST }));

    expect(out.files).toEqual(['page.js']);
    expect(out.page).not.toMatch(/sourceMappingURL/);
    expect(out.page).toMatch(/__va\(\d+\)/);
    expect(out.page).toBe((await written(resolve(mapped.root, 'out'))).page);
  }, 60_000);
});

describe('rsbuildFinal in a real Rsbuild build', () => {
  it('runs the probes after a post loader the project lists, so it reads no probe', async () => {
    const { root, refuses } = await project();
    await rsbuilt(await rsbuildFinal(rsbuildShaped(root, refuses, true, 'development'), { root, configType: 'DEVELOPMENT' }), root);
    expect(await emitted(resolve(root, 'out'))).toMatch(/__va\(\d+\)/);
  }, 60_000);

  it('hands the loaders maps in a production build that writes none, as `storybook build --test` does, and still writes no map', async () => {
    const { root, refuses } = await project();
    await rsbuilt(await rsbuildFinal(rsbuildShaped(root, refuses, { js: false, css: false }, 'production'), { root, ...TEST }), root);
    const out = await written(resolve(root, 'out'), 'index.js');
    const mapped = await project();
    await rsbuilt(await rsbuildFinal(rsbuildShaped(mapped.root, mapped.refuses, { js: 'hidden-source-map' }, 'production'), { root: mapped.root, ...TEST }), mapped.root);

    expect(out.files.filter((file) => file.endsWith('.map'))).toEqual([]);
    expect(out.page).not.toMatch(/sourceMappingURL/);
    expect(out.page).toMatch(/__va\(\d+\)/);
    expect(out.page).toBe((await written(resolve(mapped.root, 'out'), 'index.js')).page);
  }, 60_000);
});

/** The addon, by the path Storybook loads a preset from. */
const ADDON = resolve(import.meta.dirname, 'preset.ts');
/** The probes, as a `main.js` outside this package requires them. */
const JOURNAL = resolve(import.meta.dirname, '../../sense/dist/test-selection/journal.js');

/**
 * Storybook's presets for a `.storybook` whose `main.js` lists the addon and
 * holds `hooks`, the text of its builder hooks: Storybook runs the addon's
 * hooks first and the project's after them, whatever `addons` lists.
 */
async function storybook(root: string, hooks: string, addon = ADDON) {
  const configDir = resolve(root, '.storybook');
  await mkdir(configDir, { recursive: true });
  await writeFile(
    resolve(configDir, 'main.cjs'),
    `const { testSelectionProbes, testSelectionRule } = require(${JSON.stringify(JOURNAL)});\n` +
      `module.exports = {\n  stories: [],\n  addons: [{ name: ${JSON.stringify(addon)}, options: { root: ${JSON.stringify(root)} } }],\n${hooks}\n};\n`,
  );
  return loadAllPresets({ configDir, corePresets: [], overridePresets: [], packageJson: {}, isCritical: true, ...TEST });
}

describe('the addon under Storybook, whose project hooks run after it', () => {
  it('runs the probes after a post loader `main.js` adds in its `webpackFinal`', async () => {
    const { root, refuses } = await project();
    const presets = await storybook(
      root,
      `  webpackFinal: async (config) => ({ ...config, module: { ...config.module, rules: [{ test: /\\.ts$/, enforce: 'post', use: [{ loader: ${JSON.stringify(refuses)} }] }, ...config.module.rules] } }),`,
    );
    const { module, ...shaped } = webpackShaped(root, refuses, false, 'production');
    const swc = module!.rules!.slice(0, 1);
    await built(await presets.apply('webpackFinal', { ...shaped, module: { rules: swc } }));

    expect(await emitted(resolve(root, 'out'))).toMatch(/__va\(\d+\)/);
  }, 60_000);

  it('refuses a `testSelectionRule()` `main.js` adds in its `webpackFinal`, which the addon places', async () => {
    const { root, refuses } = await project();
    const presets = await storybook(
      root,
      '  webpackFinal: async (config) => ({ ...config, module: { ...config.module, rules: [testSelectionRule(), ...config.module.rules] } }),',
    );
    const config = await presets.apply('webpackFinal', webpackShaped(root, refuses, false, 'production'));

    await expect(built(config)).rejects.toThrow(/remove your testSelectionRule\(\); the addon places it/);
  }, 60_000);

  it('runs the probes after a post loader `main.js` adds in its `rsbuildFinal`', async () => {
    const { root, refuses } = await project();
    const presets = await storybook(
      root,
      '  rsbuildFinal: async (config) => ({ ...config, tools: { ...config.tools, rspack: [...[config.tools?.rspack ?? []].flat(), ' +
        `(rspack) => { rspack.module.rules.unshift({ test: /\\.ts$/, enforce: 'post', use: [{ loader: ${JSON.stringify(refuses)} }] }); }] } }),`,
    );
    const { tools, ...shaped } = rsbuildShaped(root, refuses, { js: false, css: false }, 'production');
    await rsbuilt(await presets.apply('rsbuildFinal', { ...shaped, tools: { ...tools, rspack: [] } }), root);

    expect(await emitted(resolve(root, 'out'))).toMatch(/__va\(\d+\)/);
  }, 60_000);

  it('refuses a `testSelectionProbes()` `main.js` adds in its `viteFinal`, which the addon places', async () => {
    const { root } = await project();
    const presets = await storybook(root, '  viteFinal: async (config) => ({ ...config, plugins: [...(config.plugins ?? []), testSelectionProbes()] }),');
    const config = await presets.apply<InlineConfig>('viteFinal', { root, configFile: false, logLevel: 'silent', plugins: [] });

    await expect(resolveConfig(config, 'build')).rejects.toThrow(/remove your testSelectionProbes\(\); the addon places it/);
  }, 60_000);

  it('adds no second Vite probes plugin where the config holds one before the addon runs, as `vite.config` does', async () => {
    const { root } = await project();
    const presets = await storybook(root, '');
    const { testSelectionProbes } = (await import(JOURNAL)) as typeof import('@variance-authority/sense/journal');
    const config = await presets.apply<InlineConfig>('viteFinal', { root, configFile: false, logLevel: 'silent', plugins: [testSelectionProbes()] });

    const resolved = await resolveConfig(config, 'build');
    expect(resolved.plugins.filter((plugin) => plugin.name === 'variance-authority:test-selection-probes')).toHaveLength(1);
  }, 60_000);

  it.each(['@variance-authority/storybook-collector', '@variance-authority/storybook-collector/preset'])(
    'loads the preset by the name `addons` lists, %s, as a project that installed the package does',
    async (name) => {
      const { root, refuses } = await project();
      // The project's own `node_modules`, where Storybook resolves an addon's name from `.storybook`.
      await symlink(resolve(import.meta.dirname, '../../../node_modules'), resolve(root, 'node_modules'), 'dir');
      const presets = await storybook(root, '', name);
      await built(await presets.apply('webpackFinal', webpackShaped(root, refuses, false, 'production')));

      expect(await emitted(resolve(root, 'out'))).toMatch(/__va\(\d+\)/);
    },
    60_000,
  );
});
