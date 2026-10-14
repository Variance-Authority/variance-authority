/**
 * The preset's rule in a real Rspack build, next to a post loader of the
 * project's that cannot read a probe, and in a production build that writes no
 * source map, as `storybook build --test` does.
 */

import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createRsbuild, type RsbuildConfig } from '@rsbuild/core';
import { rspack, type Configuration } from '@rspack/core';
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
