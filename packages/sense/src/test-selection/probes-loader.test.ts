import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { parseSync } from 'oxc-parser';
import { afterEach, describe, expect, it } from 'vitest';
import { decode } from './map-segments.js';
import probesLoader, { type ProbesLoaderContext } from './probes-loader.js';
import { executionCollectorSource } from './probes.js';
import { testSelectionRule, type ProbesLoaderOptions } from './probes-rule.js';
import type { HandedMap } from './loader-probes.js';

const SOURCE = 'export function total(items) {\n  return items.length > 0 ? items.length : 0;\n}\n';
// Every line to itself, from its first column.
const IDENTITY = { version: 3, sources: ['cart.js'], names: [], mappings: 'AAAA;AACA;AACA' };

let root: string | undefined;

afterEach(async () => {
  if (root !== undefined) await rm(root, { force: true, recursive: true });
  root = undefined;
});

/** What the loader handed on for `file` under `options`: code, map, or the error. */
function load(file: string, code: string, map: HandedMap, options: ProbesLoaderOptions & { collector?: string }, loaders?: readonly { path: string }[]) {
  let handed: { error: Error | null; code?: string; map?: HandedMap } | undefined;
  const context: ProbesLoaderContext = {
    resourcePath: file,
    getOptions: () => options,
    ...(loaders === undefined ? {} : { loaders }),
    callback: (error, text, given) => {
      handed = { error, code: text, map: given };
    },
  };
  probesLoader.call(context, code, map);
  return handed!;
}

/** What `code` loads through `import`, `import()` and `export … from`, as the parser reads it; a text it cannot parse throws. */
function imported(code: string): string[] {
  const { errors, module } = parseSync('handed.js', code, { sourceType: 'module' });
  if (errors.length > 0) throw new Error(errors.map((error) => error.message).join('\n'));
  return [
    ...module.staticImports.map((entry) => entry.moduleRequest.value),
    ...module.dynamicImports.map((entry) => code.slice(entry.moduleRequest.start, entry.moduleRequest.end)),
    ...module.staticExports.flatMap((entry) => entry.entries.flatMap((exported) => (exported.moduleRequest ? [exported.moduleRequest.value] : []))),
  ];
}

async function checkout(): Promise<string> {
  root = await mkdtemp(resolve(tmpdir(), 'variance-probes-loader-'));
  await writeFile(resolve(root, 'cart.js'), SOURCE, 'utf8');
  return root;
}

describe('the probes loader', () => {
  it('serves the collector of the recipe it is asked for', () => {
    expect(load('/anywhere/probes-collector.js', 'export {};\n', undefined, { collector: 'entries' }).code).toBe(
      executionCollectorSource('entries'),
    );
  });

  it('serves the collector of the loads recipe, and marks a module under it rather than probing it', async () => {
    expect(load('/anywhere/probes-collector.js', 'export {};\n', undefined, { collector: 'loads' }).code).toBe(
      executionCollectorSource('loads'),
    );
    const root = await checkout();
    const { error, code } = load(resolve(root, 'cart.js'), SOURCE, undefined, { root, mode: 'loads' });

    expect(error).toBeNull();
    expect(code!.startsWith(`${SOURCE}\n;`)).toBe(true);
    expect(code).toContain('.m("cart.js@~');
    expect(code).not.toMatch(/__va\(\d+\)/);
  });

  it('refuses a collector of a recipe that is none', () => {
    expect(load('/anywhere/probes-collector.js', '', undefined, { collector: 'lines' }).error?.message).toMatch(/recipe "lines"/);
  });

  it('ends a module it probes with an import of the collector, so a directive prologue stays first and no column moves', async () => {
    const root = await checkout();
    const client = `"use client";\n${SOURCE}`;
    await writeFile(resolve(root, 'client.js'), client, 'utf8');
    const { error, code, map } = load(resolve(root, 'client.js'), client, { ...IDENTITY, mappings: 'AAAA;AACA;AACA;AACA' }, { root });

    expect(error).toBeNull();
    expect(code!.startsWith('"use client";')).toBe(true);
    expect(code!.slice(code!.lastIndexOf('\n'))).toMatch(/^\n;import "!!.*probes-loader\.js\?collector=presence!.*probes-collector\.js";$/);
    // The second line opens with the header, where the map says.
    const lines = code!.split('\n');
    const columns = decode((map as { mappings: string }).mappings)[1]!.map((segment) => segment.column);
    expect(lines[1]!.indexOf('var __vaK')).toBe(0);
    expect(columns).toEqual([0]);
  });

  it('ends an `.mjs` file with an import of the collector even where its text reads as a script, since it has no `require`', async () => {
    const root = await checkout();
    const script = 'function total(items) {\n  return items.length > 0 ? items.length : 0;\n}\nglobalThis.total = total;\n';
    await writeFile(resolve(root, 'total.mjs'), script, 'utf8');
    const { error, code } = load(resolve(root, 'total.mjs'), script, { ...IDENTITY, sources: ['total.mjs'], mappings: 'AAAA;AACA;AACA;AACA' }, { root });

    expect(error).toBeNull();
    expect(code).not.toContain('require(');
    expect(code!.slice(code!.lastIndexOf('\n'))).toMatch(/^\n;import "!!.*probes-loader\.js\?collector=presence!.*probes-collector\.js";$/);
  });

  it('opens a script with a require of the collector after its prologue, so it stays strict, and moves the map with it', async () => {
    const root = await checkout();
    const script = '"use strict"; function total(items) {\n  return items.length > 0 ? items.length : 0;\n}\nmodule.exports = { total };\n';
    await writeFile(resolve(root, 'total.js'), script, 'utf8');
    // Line 1: the directive at 0, the function at 14.
    const { error, code, map } = load(resolve(root, 'total.js'), script, { ...IDENTITY, sources: ['total.js'], mappings: 'AAAA,cAAc;AACd;AACA;AACA' }, { root });

    expect(error).toBeNull();
    const first = code!.split('\n')[0]!;
    expect(first.startsWith('"use strict";')).toBe(true);
    expect(first.indexOf('require("!!')).toBeLessThan(first.indexOf('var __vaK'));
    expect(imported(code!)).toEqual([]);
    // The header, which the map maps to the function, is where the map says, past the require.
    const columns = decode((map as { mappings: string }).mappings)[0]!.map((segment) => segment.column);
    expect(columns).toEqual([0, first.indexOf('var __vaK')]);
  });

  it('takes a map handed on as its JSON text ahead of the loaders, as `swc-loader` hands one without `parseMap`', async () => {
    const root = await checkout();
    const script = '"use strict"; function total(items) {\n  return items.length > 0 ? items.length : 0;\n}\nmodule.exports = { total };\n';
    await writeFile(resolve(root, 'total.js'), script, 'utf8');
    const handed = JSON.stringify({ ...IDENTITY, sources: ['total.js'], mappings: 'AAAA,cAAc;AACd;AACA;AACA' });
    const { error, code, map } = load(resolve(root, 'total.js'), script, handed, { root, placement: 'before-transforms' });

    expect(error).toBeNull();
    const first = code!.split('\n')[0]!;
    expect(first.indexOf('require("!!')).toBeLessThan(first.indexOf('var __vaK'));
    expect(map).toMatchObject({ sources: ['total.js'] });
    // Read as an object, the map moves past the require like one handed on as an object.
    const required = first.slice(first.indexOf('require("!!'), first.indexOf(');', first.indexOf('require("!!')) + 2);
    expect(decode((map as { mappings: string }).mappings)[0]!.map((segment) => segment.column)).toEqual([0, 14 + required.length]);
  });

  // A file the instrumenter cannot parse, such as one with Flow's annotations,
  // is marked as loaded rather than probed, from what the loaders wrote.
  const FLOW_SCRIPT = '// @flow\nfunction total(items: Array<number>) {\n  return items.length;\n}\nmodule.exports = { total };\n';
  const FLOW_MODULE = '// @flow\nexport function total(items: Array<number>) {\n  return items.length;\n}\n';
  const STRIPPED = { version: 3, names: [], mappings: 'AAAA;AACA;AACA;AACA;AACA' };

  it('takes the collector into a script it marks with a require, not an import, so its `module.exports` is still read', async () => {
    const root = await checkout();
    await writeFile(resolve(root, 'flow.js'), FLOW_SCRIPT, 'utf8');
    const written = FLOW_SCRIPT.replace(': Array<number>', '');
    const { error, code } = load(resolve(root, 'flow.js'), written, { ...STRIPPED, sources: ['flow.js'] }, { root });

    expect(error).toBeNull();
    expect(code).toMatch(/;globalThis\.__VA__\.m\("[^"\n]*"\);/);
    expect(code!.startsWith(`${written}\n;require("!!`)).toBe(true);
    expect(imported(code!)).toEqual([]);
  });

  it('takes the collector into a module it marks with an import, as into one it probes', async () => {
    const root = await checkout();
    await writeFile(resolve(root, 'flow.js'), FLOW_MODULE, 'utf8');
    const written = FLOW_MODULE.replace(': Array<number>', '');
    const { error, code } = load(resolve(root, 'flow.js'), written, { ...STRIPPED, sources: ['flow.js'] }, { root });

    expect(error).toBeNull();
    expect(code).toMatch(/;globalThis\.__VA__\.m\("[^"\n]*"\);/);
    expect(code).not.toMatch(/\brequire\(/);
    expect(code!.startsWith(`${written}\n;import "!!`)).toBe(true);
  });

  it('refuses a module the loaders before it rewrote and handed on no map, naming `devtool`', async () => {
    const root = await checkout();
    const { error } = load(resolve(root, 'cart.js'), `// rewritten\n${SOURCE}`, undefined, { root });

    expect(error?.message).toMatch(/`cart\.js`.*devtool/s);
  });

  it.each([
    ['missing map', undefined],
    ['mismatched source text', { ...IDENTITY, sourcesContent: [`// rewritten\n${SOURCE}`] }],
  ] as const)('names the configured loader chain when refusing a %s', async (_, map) => {
    const root = await checkout();
    const loaders = [{ path: '/loaders/rewrite.js' }, { path: '/loaders/compiler.js' }];
    const { error } = load(resolve(root, 'cart.js'), `// rewritten\n${SOURCE}`, map, { root }, loaders);

    expect(error?.message).toContain('Loader chain as listed by the bundler:\n  /loaders/rewrite.js\n  /loaders/compiler.js');
  });

  it('passes a module the default `include` refuses untouched', async () => {
    const root = await checkout();
    await writeFile(resolve(root, 'cart.test.js'), SOURCE, 'utf8');
    const handed = load(resolve(root, 'cart.test.js'), SOURCE, IDENTITY, { root });

    expect(handed).toEqual({ error: null, code: SOURCE, map: IDENTITY });
  });
});

describe('the rule', () => {
  it('runs the loader after the project’s, with `include` as the rule’s own condition and the loader’s options data alone', () => {
    const include = (file: string) => file.endsWith('.ts');
    const rule = testSelectionRule({ root: process.cwd(), include, mode: 'entries' });

    expect(rule).toMatchObject({ enforce: 'post', include, use: [{ loader: expect.stringMatching(/probes-loader\.js$/) }] });
    expect(rule.use[0].options).toEqual({ root: expect.any(String), mode: 'entries', include: 'rule' });
  });

  it('takes every module the rule’s condition hands it, when `include` is the rule’s', async () => {
    const root = await checkout();
    const { error, code } = load(resolve(root, 'cart.js'), SOURCE, IDENTITY, { root, include: 'rule' });

    expect(error).toBeNull();
    expect(code).not.toBe(SOURCE);
  });

  it('leaves `node_modules` to the loaders where `include` is the default, and to `include` where it is given', () => {
    expect(testSelectionRule().exclude).toEqual(/[\\/]node_modules[\\/]/);
    expect(testSelectionRule().exclude!.test('/repo/node_modules/react/index.js')).toBe(true);
    expect(testSelectionRule({ include: () => true }).exclude).toBeUndefined();
  });

});
